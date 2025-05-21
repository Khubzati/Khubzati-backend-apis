const { createApiResponse } = require("../utils/responseHandler");
const enMessages = require("../config/messages/en.json");
const arMessages = require("../config/messages/ar.json");
const { Cart, CartItem, Product, User } = require("../db/models");
const { sequelize } = require("../db/models"); // For transactions

// GET /cart - Get the current user's cart
exports.getCart = async (req, res) => {
  try {
    const userId = req.user.user_id;
    let cart = await Cart.findOne({
      where: { user_id: userId },
      include: [
        {
          model: CartItem,
          as: "items",
          include: [
            {
              model: Product,
              as: "product",
              attributes: ["product_id", "name_en", "name_ar", "price", "image_url", "stock_quantity", "is_available"],
            },
          ],
        },
      ],
    });

    if (!cart) {
      // If no cart exists, create one for the user
      cart = await Cart.create({ user_id: userId });
      // Re-fetch with includes to have a consistent structure, or manually build the items array as empty
      cart = await Cart.findOne({
        where: { user_id: userId },
        include: [
            {
              model: CartItem,
              as: "items",
              include: [
                {
                  model: Product,
                  as: "product",
                  attributes: ["product_id", "name_en", "name_ar", "price", "image_url", "stock_quantity", "is_available"],
                },
              ],
            },
          ],
      });
    }

    // Calculate total price (can also be a method on the Cart model)
    let totalPrice = 0;
    if (cart.items && cart.items.length > 0) {
        totalPrice = cart.items.reduce((sum, item) => {
            // Ensure product exists and price_at_addition is valid
            return sum + (parseFloat(item.price_at_addition) * item.quantity);
        }, 0);
    }

    const cartData = cart.toJSON();
    cartData.total_price = totalPrice.toFixed(2);

    return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, { cart: cartData }, true));
  } catch (error) {
    console.error("Get cart error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// POST /cart/items - Add an item to the cart
exports.addItemToCart = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const userId = req.user.user_id;
    const { product_id, quantity } = req.body;

    if (!product_id || !quantity || quantity < 1) {
      await t.rollback();
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
        [{ field: "product_id, quantity", message: { en: "Product ID and valid quantity are required.", ar: "معرف المنتج والكمية الصالحة مطلوبان."}}]
      ));
    }

    const product = await Product.findByPk(product_id);
    if (!product || !product.is_available) {
      await t.rollback();
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Product not found or not available.", ar: "المنتج غير موجود أو غير متوفر."}}, false));
    }

    if (product.stock_quantity !== null && product.stock_quantity < quantity) {
        await t.rollback();
        return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
            [{ field: "quantity", message: { en: "Insufficient stock for the requested quantity.", ar: "المخزون غير كافٍ للكمية المطلوبة."}}]
        ));
    }

    let cart = await Cart.findOne({ where: { user_id: userId }, transaction: t });
    if (!cart) {
      cart = await Cart.create({ user_id: userId }, { transaction: t });
    }

    let cartItem = await CartItem.findOne({
      where: { cart_id: cart.cart_id, product_id: product_id },
      transaction: t
    });

    if (cartItem) {
      // Item already in cart, update quantity
      cartItem.quantity += quantity;
      // Optionally re-check stock for the new total quantity
      if (product.stock_quantity !== null && product.stock_quantity < cartItem.quantity) {
        await t.rollback();
        return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
            [{ field: "quantity", message: { en: "Insufficient stock for the total requested quantity.", ar: "المخزون غير كافٍ لإجمالي الكمية المطلوبة."}}]
        ));
      }
      cartItem.price_at_addition = product.price; // Update price in case it changed
      await cartItem.save({ transaction: t });
    } else {
      // New item for the cart
      cartItem = await CartItem.create({
        cart_id: cart.cart_id,
        product_id: product_id,
        quantity: quantity,
        price_at_addition: product.price // Store current product price
      }, { transaction: t });
    }

    await t.commit();
    // Fetch the updated cart to return
    const updatedCart = await Cart.findOne({
        where: { user_id: userId },
        include: [{ model: CartItem, as: "items", include: [{ model: Product, as: "product"}] }],
    });
    let totalPrice = 0;
    if (updatedCart.items && updatedCart.items.length > 0) {
        totalPrice = updatedCart.items.reduce((sum, item) => sum + (parseFloat(item.price_at_addition) * item.quantity), 0);
    }
    const cartData = updatedCart.toJSON();
    cartData.total_price = totalPrice.toFixed(2);

    return res.status(200).json(createApiResponse(enMessages.CART_ITEM_ADDED, arMessages.CART_ITEM_ADDED, { cart: cartData }, true));
  } catch (error) {
    await t.rollback();
    console.error("Add item to cart error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// PUT /cart/items/:cartItemId - Update quantity of an item in the cart
exports.updateCartItem = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const userId = req.user.user_id;
    const { cartItemId } = req.params;
    const { quantity } = req.body;

    if (!quantity || quantity < 1) {
      await t.rollback();
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
        [{ field: "quantity", message: { en: "Valid quantity is required.", ar: "الكمية الصالحة مطلوبة."}}]
      ));
    }

    const cartItem = await CartItem.findOne({
      where: { cart_item_id: cartItemId },
      include: [
        { model: Cart, as: "cart", where: { user_id: userId } },
        { model: Product, as: "product" }
      ],
      transaction: t
    });

    if (!cartItem || !cartItem.cart) { // Check if item exists and belongs to user's cart
      await t.rollback();
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Cart item not found.", ar: "عنصر سلة التسوق غير موجود."}}, false));
    }

    const product = cartItem.product;
    if (product.stock_quantity !== null && product.stock_quantity < quantity) {
        await t.rollback();
        return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
            [{ field: "quantity", message: { en: "Insufficient stock for the requested quantity.", ar: "المخزون غير كافٍ للكمية المطلوبة."}}]
        ));
    }

    cartItem.quantity = quantity;
    cartItem.price_at_addition = product.price; // Update price in case it changed
    await cartItem.save({ transaction: t });

    await t.commit();
    // Fetch the updated cart to return
    const updatedCart = await Cart.findOne({
        where: { user_id: userId },
        include: [{ model: CartItem, as: "items", include: [{ model: Product, as: "product"}] }],
    });
    let totalPrice = 0;
    if (updatedCart.items && updatedCart.items.length > 0) {
        totalPrice = updatedCart.items.reduce((sum, item) => sum + (parseFloat(item.price_at_addition) * item.quantity), 0);
    }
    const cartData = updatedCart.toJSON();
    cartData.total_price = totalPrice.toFixed(2);

    return res.status(200).json(createApiResponse(enMessages.CART_ITEM_UPDATED, arMessages.CART_ITEM_UPDATED, { cart: cartData }, true));
  } catch (error) {
    await t.rollback();
    console.error("Update cart item error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// DELETE /cart/items/:cartItemId - Remove an item from the cart
exports.removeItemFromCart = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const userId = req.user.user_id;
    const { cartItemId } = req.params;

    const cartItem = await CartItem.findOne({
      where: { cart_item_id: cartItemId },
      include: [{ model: Cart, as: "cart", where: { user_id: userId } }],
      transaction: t
    });

    if (!cartItem || !cartItem.cart) {
      await t.rollback();
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Cart item not found.", ar: "عنصر سلة التسوق غير موجود."}}, false));
    }

    await cartItem.destroy({ transaction: t });
    await t.commit();

    // Fetch the updated cart to return
    const updatedCart = await Cart.findOne({
        where: { user_id: userId },
        include: [{ model: CartItem, as: "items", include: [{ model: Product, as: "product"}] }],
    });
    let totalPrice = 0;
    if (updatedCart.items && updatedCart.items.length > 0) {
        totalPrice = updatedCart.items.reduce((sum, item) => sum + (parseFloat(item.price_at_addition) * item.quantity), 0);
    }
    const cartData = updatedCart.toJSON();
    cartData.total_price = totalPrice.toFixed(2);

    return res.status(200).json(createApiResponse(enMessages.CART_ITEM_REMOVED, arMessages.CART_ITEM_REMOVED, { cart: cartData }, true));
  } catch (error) {
    await t.rollback();
    console.error("Remove item from cart error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// DELETE /cart - Clear all items from the cart
exports.clearCart = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const userId = req.user.user_id;
    const cart = await Cart.findOne({ where: { user_id: userId }, transaction: t });

    if (!cart) {
      await t.rollback();
      // No cart to clear, can be considered success or a specific message
      return res.status(200).json(createApiResponse(enMessages.CART_EMPTY, arMessages.CART_EMPTY, { cart: { items: [], total_price: "0.00" } }, true));
    }

    await CartItem.destroy({ where: { cart_id: cart.cart_id }, transaction: t });
    await t.commit();

    // Fetch the updated (empty) cart to return
    const updatedCart = await Cart.findOne({
        where: { user_id: userId },
        include: [{ model: CartItem, as: "items", include: [{ model: Product, as: "product"}] }],
    });
    const cartData = updatedCart.toJSON();
    cartData.total_price = "0.00";

    return res.status(200).json(createApiResponse(enMessages.CART_CLEARED, arMessages.CART_CLEARED, { cart: cartData }, true));
  } catch (error) {
    await t.rollback();
    console.error("Clear cart error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

