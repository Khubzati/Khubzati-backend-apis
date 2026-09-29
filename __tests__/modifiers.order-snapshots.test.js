process.env.NODE_ENV = 'test';
require('dotenv').config();

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';
const tokenFor = (user) =>
  jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1h' });

describe('Product modifiers and immutable order snapshots', () => {
  const ids = {
    users: [],
    vendors: [],
    restaurants: [],
    products: [],
    groups: [],
    options: [],
    orders: [],
  };
  let owner;
  let otherOwner;
  let customer;
  let ownerToken;
  let otherOwnerToken;
  let customerToken;
  let bakery;
  let product;
  let requiredGroup;
  let cheese;
  let sauce;

  beforeAll(async () => {
    const unique = Date.now();
    [owner, otherOwner, customer] = await Promise.all([
      prisma.user.create({
        data: {
          username: `modifier_bakery_${unique}`,
          email: `modifier_bakery_${unique}@example.com`,
          phoneNumber: `+96271${String(unique).slice(-7)}`,
          password: 'test-only-password-hash',
          role: 'bakery_owner',
          isVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          username: `modifier_restaurant_${unique}`,
          email: `modifier_restaurant_${unique}@example.com`,
          phoneNumber: `+96272${String(unique).slice(-7)}`,
          password: 'test-only-password-hash',
          role: 'restaurant_owner',
          isVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          username: `modifier_customer_${unique}`,
          email: `modifier_customer_${unique}@example.com`,
          phoneNumber: `+96273${String(unique).slice(-7)}`,
          password: 'test-only-password-hash',
          role: 'customer',
          isVerified: true,
        },
      }),
    ]);
    ids.users.push(owner.id, otherOwner.id, customer.id);
    ownerToken = tokenFor(owner);
    otherOwnerToken = tokenFor(otherOwner);
    customerToken = tokenFor(customer);

    bakery = await prisma.bakery.create({
      data: {
        ownerId: owner.id,
        name: 'Modifier Bakery',
        addressLine1: 'Test',
        city: 'Amman',
        postalCode: '11118',
        country: 'Jordan',
        phoneNumber: '+962790000001',
        status: 'approved',
        createdBy: owner.id,
      },
    });
    ids.vendors.push(bakery.id);
    product = await prisma.product.create({
      data: {
        name: 'Snapshot Bread',
        price: 2,
        itemType: 'bakery',
        bakeryId: bakery.id,
        stockQuantity: 20,
        isAvailable: true,
        createdBy: owner.id,
      },
    });
    ids.products.push(product.id);
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { userId: { in: ids.users } },
    });
    await prisma.inventoryMovement.deleteMany({
      where: { orderId: { in: ids.orders } },
    });
    await prisma.orderFinancialRecord.deleteMany({
      where: { orderId: { in: ids.orders } },
    });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids.orders } } });
    await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
    await prisma.modifierOption.deleteMany({
      where: { modifierGroupId: { in: ids.groups } },
    });
    await prisma.modifierGroup.deleteMany({ where: { id: { in: ids.groups } } });
    await prisma.product.deleteMany({ where: { id: { in: ids.products } } });
    await prisma.bakery.deleteMany({ where: { id: { in: ids.vendors } } });
    await prisma.restaurant.deleteMany({ where: { id: { in: ids.restaurants } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.$disconnect();
  });

  test('owner creates required multi-select group and options', async () => {
    const groupResponse = await request(app)
      .post(`/v1/products/${product.id}/modifier-groups`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        nameEn: 'Toppings',
        nameAr: 'إضافات',
        selectionType: 'multiple',
        isRequired: true,
        minSelections: 1,
        maxSelections: 2,
      });
    expect(groupResponse.status).toBe(201);
    requiredGroup = groupResponse.body.data.modifierGroup;
    ids.groups.push(requiredGroup.id);

    const createOption = (nameEn, nameAr, priceAdjustment) =>
      request(app)
        .post(
          `/v1/products/${product.id}/modifier-groups/${requiredGroup.id}/options`,
        )
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ nameEn, nameAr, priceAdjustment });

    const cheeseResponse = await createOption('Cheese', 'جبنة', 0.5);
    const sauceResponse = await createOption('Sauce', 'صلصة', 0.25);
    expect(cheeseResponse.status).toBe(201);
    expect(sauceResponse.status).toBe(201);
    cheese = cheeseResponse.body.data.modifierOption;
    sauce = sauceResponse.body.data.modifierOption;
    ids.options.push(cheese.id, sauce.id);
  });

  test('other vendor cannot mutate modifier configuration', async () => {
    const response = await request(app)
      .put(`/v1/products/${product.id}/modifier-groups/${requiredGroup.id}`)
      .set('Authorization', `Bearer ${otherOwnerToken}`)
      .send({ nameEn: 'Hijacked' });
    expect(response.status).toBe(403);
  });

  test('restaurant owner can manage only their own product modifiers', async () => {
    const restaurant = await prisma.restaurant.create({
      data: {
        ownerId: otherOwner.id,
        name: 'Modifier Restaurant',
        cuisineType: 'Test',
        addressLine1: 'Test',
        city: 'Amman',
        postalCode: '11118',
        country: 'Jordan',
        phoneNumber: '+962790000099',
        status: 'approved',
      },
    });
    ids.restaurants.push(restaurant.id);
    const restaurantProduct = await prisma.product.create({
      data: {
        restaurantId: restaurant.id,
        itemType: 'restaurant_menu',
        name: 'Modifier Meal',
        price: 4,
        stockQuantity: 5,
        isAvailable: true,
      },
    });
    ids.products.push(restaurantProduct.id);
    const own = await request(app)
      .post(`/v1/products/${restaurantProduct.id}/modifier-groups`)
      .set('Authorization', `Bearer ${otherOwnerToken}`)
      .send({
        nameEn: 'Size',
        nameAr: 'الحجم',
        selectionType: 'single',
        isRequired: false,
        minSelections: 0,
        maxSelections: 1,
      });
    expect(own.status).toBe(201);
    ids.groups.push(own.body.data.modifierGroup.id);
  });

  test('optional single-select permits none and rejects multiple selections', async () => {
    const group = await request(app)
      .post(`/v1/products/${product.id}/modifier-groups`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        nameEn: 'Packaging',
        nameAr: 'التغليف',
        selectionType: 'single',
        isRequired: false,
        minSelections: 0,
        maxSelections: 1,
      });
    expect(group.status).toBe(201);
    const groupId = group.body.data.modifierGroup.id;
    ids.groups.push(groupId);
    const optionResponses = await Promise.all(['Box', 'Bag'].map((name) =>
      request(app)
        .post(`/v1/products/${product.id}/modifier-groups/${groupId}/options`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ nameEn: name, nameAr: name === 'Box' ? 'صندوق' : 'كيس', priceAdjustment: 0 }),
    ));
    const optionIds = optionResponses.map((response) => response.body.data.modifierOption.id);
    ids.options.push(...optionIds);

    const optionalNone = await request(app)
      .post('/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        orderType: 'pickup',
        paymentMethod: 'CASH_ON_DELIVERY',
        items: [{ productId: product.id, quantity: 1, selectedModifierOptionIds: [cheese.id] }],
      });
    expect(optionalNone.status).toBe(201);
    ids.orders.push(optionalNone.body.data.order.id);

    const tooMany = await request(app)
      .post('/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        orderType: 'pickup',
        paymentMethod: 'CASH_ON_DELIVERY',
        items: [{
          productId: product.id,
          quantity: 1,
          selectedModifierOptionIds: [cheese.id, ...optionIds],
        }],
      });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.message).toMatch(/at most 1/);
  });

  test('checkout enforces required minimum and rejects foreign options', async () => {
    const missing = await request(app)
      .post('/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        orderType: 'pickup',
        paymentMethod: 'CASH_ON_DELIVERY',
        items: [{ productId: product.id, quantity: 1 }],
      });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toMatch(/requires at least 1/);

    const foreign = await request(app)
      .post('/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        orderType: 'pickup',
        paymentMethod: 'CASH_ON_DELIVERY',
        items: [{
          productId: product.id,
          quantity: 1,
          selectedModifierOptionIds: [
            cheese.id,
            '00000000-0000-0000-0000-000000000000',
          ],
        }],
      });
    expect(foreign.status).toBe(400);
    expect(foreign.body.message).toMatch(/does not belong|unavailable/);
  });

  test('server prices modifiers and persists immutable snapshots', async () => {
    const response = await request(app)
      .post('/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        orderType: 'pickup',
        paymentMethod: 'CASH_ON_DELIVERY',
        totalAmount: 0.01,
        items: [{
          productId: product.id,
          quantity: 2,
          price: 0.01,
          selectedModifierOptionIds: [cheese.id, sauce.id],
        }],
      });
    expect(response.status).toBe(201);
    const order = response.body.data.order;
    ids.orders.push(order.id);
    expect(Number(order.totalAmount)).toBe(5.5);

    const item = await prisma.orderItem.findFirst({ where: { orderId: order.id } });
    expect(item.productNameSnapshot).toBe('Snapshot Bread');
    expect(Number(item.modifierAdjustmentSnapshot)).toBe(0.75);
    expect(Number(item.unitPriceSnapshot)).toBe(2.75);
    expect(Number(item.itemTotalSnapshot)).toBe(5.5);
    expect(item.selectedModifiersSnapshot[0].options).toHaveLength(2);

    await prisma.product.update({
      where: { id: product.id },
      data: { name: 'Renamed Bread', imageUrl: '/changed.png' },
    });
    await prisma.modifierOption.update({
      where: { id: cheese.id },
      data: { nameEn: 'Renamed Cheese', deletedAt: new Date(), isAvailable: false },
    });

    const historical = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(historical.productNameSnapshot).toBe('Snapshot Bread');
    expect(historical.selectedModifiersSnapshot[0].options[0].nameEn).toBe('Cheese');
  });

  test('inactive options and suspended vendors are rejected', async () => {
    const inactive = await request(app)
      .post('/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        orderType: 'pickup',
        paymentMethod: 'CASH_ON_DELIVERY',
        items: [{
          productId: product.id,
          quantity: 1,
          selectedModifierOptionIds: [cheese.id],
        }],
      });
    expect(inactive.status).toBe(400);

    await prisma.bakery.update({ where: { id: bakery.id }, data: { status: 'suspended' } });
    const mutation = await request(app)
      .post(`/v1/products/${product.id}/modifier-groups`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        nameEn: 'Blocked',
        nameAr: 'محظور',
        selectionType: 'single',
        minSelections: 0,
        maxSelections: 1,
      });
    expect(mutation.status).toBe(403);
  });
});
