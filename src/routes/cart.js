const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const prisma = require('../lib/prisma');

const router = express.Router();
router.use(authenticateToken, authorizeRole(['customer']));

const optionIdsFrom = (value) => {
  const raw = value?.selectedModifierOptionIds || value?.optionIds || [];
  return [...new Set(Array.isArray(raw) ? raw.map(String).filter(Boolean) : [])].sort();
};

const configurationKey = (productId, optionIds) =>
  `${productId}:${[...optionIds].sort().join(',')}`;

const advisoryLockId = (value) => {
  let hash = 0;
  for (const code of Buffer.from(String(value))) hash = ((hash * 31) + code) | 0;
  return hash;
};

const loadProductConfiguration = async (productId, selectedModifierOptionIds) => {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    include: {
      bakery: { select: { id: true, status: true, name: true } },
      restaurant: { select: { id: true, status: true, name: true } },
      modifierGroups: {
        where: { deletedAt: null, isAvailable: true },
        orderBy: { sortOrder: 'asc' },
        include: {
          options: {
            where: { deletedAt: null, isAvailable: true },
            orderBy: { sortOrder: 'asc' },
          },
        },
      },
    },
  });
  if (!product || !product.isAvailable || Number(product.stockQuantity) <= 0) {
    const error = new Error('Product is unavailable');
    error.statusCode = 400;
    throw error;
  }
  const vendor = product.bakery || product.restaurant;
  if (!vendor || vendor.status !== 'approved') {
    const error = new Error('Vendor is not available for orders');
    error.statusCode = 403;
    throw error;
  }

  const optionIds = optionIdsFrom({ selectedModifierOptionIds });
  const selectedSet = new Set(optionIds);
  const allOptions = new Map();
  let modifierAdjustment = 0;
  const selectedGroups = [];

  for (const group of product.modifierGroups) {
    group.options.forEach((option) => allOptions.set(option.id, { option, group }));
    const selected = group.options.filter((option) => selectedSet.has(option.id));
    if (selected.length < group.minSelections || (group.isRequired && selected.length === 0)) {
      throw Object.assign(new Error(`${group.nameEn} requires at least ${group.minSelections || 1} selection(s)`), { statusCode: 400 });
    }
    if (selected.length > group.maxSelections || (group.selectionType === 'single' && selected.length > 1)) {
      throw Object.assign(new Error(`${group.nameEn} allows at most ${group.selectionType === 'single' ? 1 : group.maxSelections} selection(s)`), { statusCode: 400 });
    }
    if (selected.length) {
      selectedGroups.push({
        groupId: group.id,
        nameEn: group.nameEn,
        nameAr: group.nameAr,
        options: selected.map((option) => {
          const priceAdjustment = Number(option.priceAdjustment);
          modifierAdjustment += priceAdjustment;
          return {
            optionId: option.id,
            nameEn: option.nameEn,
            nameAr: option.nameAr,
            priceAdjustment,
          };
        }),
      });
    }
  }
  for (const optionId of optionIds) {
    if (!allOptions.has(optionId)) {
      throw Object.assign(new Error('A selected modifier option is unavailable or does not belong to this product'), { statusCode: 400 });
    }
  }

  return {
    product,
    vendorId: vendor.id,
    vendorType: product.bakery ? 'bakery' : 'restaurant',
    optionIds,
    selectedGroups,
    unitPrice: Number(product.price) + modifierAdjustment,
  };
};

const serializeCart = async (userId) => {
  const cart = await prisma.cart.findFirst({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: {
      cartItems: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: { product: true },
      },
    },
  });
  return cart || { id: null, userId, totalAmount: 0, cartItems: [] };
};

const recalculateCart = async (cartId) => {
  const items = await prisma.cartItem.findMany({
    where: { cartId, deletedAt: null },
    select: { subtotal: true },
  });
  const totalAmount = items.reduce((sum, item) => sum + Number(item.subtotal), 0);
  await prisma.cart.update({ where: { id: cartId }, data: { totalAmount } });
};

router.get('/', async (req, res) => {
  const cart = await serializeCart(req.user.id);
  return res.status(200).json({ status: 'success', data: { cart } });
});

router.post('/items', async (req, res) => {
  try {
    const productId = String(req.body?.productId || '');
    const quantity = Number(req.body?.quantity || 1);
    if (!productId || !Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ status: 'fail', message: 'Valid productId and quantity are required' });
    }
    const resolved = await loadProductConfiguration(productId, req.body?.selectedModifierOptionIds);
    if (quantity > Number(resolved.product.stockQuantity)) {
      return res.status(400).json({ status: 'fail', message: 'Requested quantity exceeds available stock' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock($1)',
        advisoryLockId(`active-cart:${req.user.id}`),
      );
      let cart = await tx.cart.findFirst({ where: { userId: req.user.id, deletedAt: null } });
      if (!cart) cart = await tx.cart.create({ data: { userId: req.user.id, createdBy: req.user.id } });
      const activeItems = await tx.cartItem.findMany({
        where: { cartId: cart.id, deletedAt: null },
        include: { product: { select: { bakeryId: true, restaurantId: true } } },
      });
      const hasOtherVendor = activeItems.some((item) =>
        (resolved.vendorType === 'bakery' && item.product.bakeryId !== resolved.vendorId) ||
        (resolved.vendorType === 'restaurant' && item.product.restaurantId !== resolved.vendorId) ||
        (resolved.vendorType === 'bakery' && item.product.restaurantId) ||
        (resolved.vendorType === 'restaurant' && item.product.bakeryId));
      if (hasOtherVendor) {
        throw Object.assign(new Error('Cart can only contain products from one vendor'), { statusCode: 409 });
      }

      const key = configurationKey(productId, resolved.optionIds);
      const existing = activeItems.find((item) =>
        configurationKey(item.productId, optionIdsFrom(item.selectedModifiers)) === key);
      const selectedModifiers = {
        selectedModifierOptionIds: resolved.optionIds,
        groups: resolved.selectedGroups,
      };
      if (existing) {
        const nextQuantity = existing.quantity + quantity;
        if (nextQuantity > Number(resolved.product.stockQuantity)) {
          throw Object.assign(new Error('Requested quantity exceeds available stock'), { statusCode: 400 });
        }
        await tx.cartItem.update({
          where: { id: existing.id },
          data: {
            quantity: nextQuantity,
            price: resolved.unitPrice,
            subtotal: resolved.unitPrice * nextQuantity,
            selectedModifiers,
            specialInstructions: req.body?.specialInstructions ?? existing.specialInstructions,
            updatedBy: req.user.id,
          },
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: cart.id,
            productId,
            quantity,
            price: resolved.unitPrice,
            subtotal: resolved.unitPrice * quantity,
            selectedModifiers,
            specialInstructions: String(req.body?.specialInstructions || '').trim() || null,
            createdBy: req.user.id,
          },
        });
      }
      const items = await tx.cartItem.findMany({
        where: { cartId: cart.id, deletedAt: null },
        select: { subtotal: true },
      });
      await tx.cart.update({
        where: { id: cart.id },
        data: { totalAmount: items.reduce((sum, item) => sum + Number(item.subtotal), 0) },
      });
    });
    return res.status(201).json({ status: 'success', data: { cart: await serializeCart(req.user.id) } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: error.statusCode ? 'fail' : 'error',
      message: error.statusCode ? error.message : 'Unable to add cart item',
    });
  }
});

router.put('/items/:itemId', async (req, res) => {
  try {
    const item = await prisma.cartItem.findFirst({
      where: { id: req.params.itemId, deletedAt: null, cart: { userId: req.user.id, deletedAt: null } },
    });
    if (!item) return res.status(404).json({ status: 'fail', message: 'Cart item not found' });
    const quantity = Number(req.body?.quantity ?? item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ status: 'fail', message: 'Quantity must be a positive integer' });
    }
    const selectedIds = req.body?.selectedModifierOptionIds ?? optionIdsFrom(item.selectedModifiers);
    const resolved = await loadProductConfiguration(item.productId, selectedIds);
    if (quantity > Number(resolved.product.stockQuantity)) {
      return res.status(400).json({ status: 'fail', message: 'Requested quantity exceeds available stock' });
    }
    await prisma.cartItem.update({
      where: { id: item.id },
      data: {
        quantity,
        price: resolved.unitPrice,
        subtotal: resolved.unitPrice * quantity,
        selectedModifiers: {
          selectedModifierOptionIds: resolved.optionIds,
          groups: resolved.selectedGroups,
        },
        specialInstructions: req.body?.specialInstructions ?? item.specialInstructions,
        updatedBy: req.user.id,
      },
    });
    await recalculateCart(item.cartId);
    return res.status(200).json({ status: 'success', data: { cart: await serializeCart(req.user.id) } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ status: error.statusCode ? 'fail' : 'error', message: error.statusCode ? error.message : 'Unable to update cart item' });
  }
});

router.delete('/items/:itemId', async (req, res) => {
  const item = await prisma.cartItem.findFirst({
    where: { id: req.params.itemId, deletedAt: null, cart: { userId: req.user.id, deletedAt: null } },
  });
  if (!item) return res.status(404).json({ status: 'fail', message: 'Cart item not found' });
  await prisma.cartItem.update({ where: { id: item.id }, data: { deletedAt: new Date(), updatedBy: req.user.id } });
  await recalculateCart(item.cartId);
  return res.status(200).json({ status: 'success', data: { cart: await serializeCart(req.user.id) } });
});

router.delete('/', async (req, res) => {
  const carts = await prisma.cart.findMany({ where: { userId: req.user.id, deletedAt: null }, select: { id: true } });
  const cartIds = carts.map(({ id }) => id);
  await prisma.cartItem.updateMany({ where: { cartId: { in: cartIds }, deletedAt: null }, data: { deletedAt: new Date(), updatedBy: req.user.id } });
  await prisma.cart.updateMany({ where: { id: { in: cartIds } }, data: { totalAmount: 0, updatedBy: req.user.id } });
  return res.status(200).json({ status: 'success', data: { cart: await serializeCart(req.user.id) } });
});

module.exports = router;
