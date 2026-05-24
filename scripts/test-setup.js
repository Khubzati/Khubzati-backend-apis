const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';
const envPath = path.join(__dirname, '..', 'Khubzati_API.postman_environment.json');
const collectionPath = path.join(__dirname, '..', 'Khubzati_API.postman_collection.json');
const sampleFile = path.join(__dirname, '..', 'uploads', 'sample.txt');

async function ensureSampleFile() {
  if (!fs.existsSync(path.dirname(sampleFile))) fs.mkdirSync(path.dirname(sampleFile), { recursive: true });
  if (!fs.existsSync(sampleFile)) fs.writeFileSync(sampleFile, 'sample upload file');
}

async function upsertUser({ email, username, phone, role }) {
  const password = await bcrypt.hash('Password@123', 10);
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { email },
        { username },
        { phoneNumber: phone },
      ],
    },
  });

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        email,
        username,
        password,
        fullName: username,
        phoneNumber: phone,
        role,
        isVerified: true,
        deletedAt: null,
      },
    });
  }

  return prisma.user.create({
    data: {
      email,
      username,
      password,
      fullName: username,
      phoneNumber: phone,
      role,
      isVerified: true,
    },
  });
}

async function seed() {
  await ensureSampleFile();

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@khubzati.com';
  const admin = await upsertUser({ email: adminEmail, username: 'admin', phone: '+962790000000', role: 'admin' });
  const bakeryOwner = await upsertUser({ email: 'bakery_owner@example.com', username: 'bakery_owner', phone: '+962790000111', role: 'bakery_owner' });
  const restaurantOwner = await upsertUser({ email: 'restaurant_owner@example.com', username: 'restaurant_owner', phone: '+962790000222', role: 'restaurant_owner' });
  const customer = await upsertUser({ email: 'customer@example.com', username: 'customer', phone: '+962790000333', role: 'customer' });
  const driver = await upsertUser({ email: 'driver@example.com', username: 'driver', phone: '+962790000444', role: 'driver' });

  const address = await prisma.address.upsert({
    where: { id: 'test-address-id' },
    update: {},
    create: {
      id: 'test-address-id',
      userId: customer.id,
      addressLine1: '123 Main St',
      city: 'Amman',
      postalCode: '11118',
      country: 'Jordan',
      addressType: 'home',
      isDefault: true,
    },
  });

  const category = await prisma.category.upsert({
    where: { id: 'test-category-id' },
    update: { deletedAt: null },
    create: {
      id: 'test-category-id',
      name: 'Bakery Goods',
      type: 'bakery',
    },
  });

  const bakery = await prisma.bakery.upsert({
    where: { id: 'test-bakery-id' },
    update: {
      ownerId: bakeryOwner.id,
      status: 'approved',
      deletedAt: null,
    },
    create: {
      id: 'test-bakery-id',
      name: 'Test Bakery',
      description: 'Seed bakery',
      addressLine1: 'Bakery St',
      city: 'Amman',
      postalCode: '11118',
      country: 'Jordan',
      phoneNumber: '+962790000111',
      email: 'bakery@test.com',
      status: 'approved',
      ownerId: bakeryOwner.id,
    },
  });

  const restaurant = await prisma.restaurant.upsert({
    where: { id: 'test-restaurant-id' },
    update: { ownerId: restaurantOwner.id, status: 'approved', deletedAt: null },
    create: {
      id: 'test-restaurant-id',
      name: 'Test Restaurant',
      description: 'Seed restaurant',
      cuisineType: 'Fusion',
      addressLine1: 'Restaurant Rd',
      city: 'Amman',
      postalCode: '11118',
      country: 'Jordan',
      phoneNumber: '+962790000222',
      email: 'restaurant@test.com',
      status: 'approved',
      ownerId: restaurantOwner.id,
    },
  });

  const bakeryProduct = await prisma.product.upsert({
    where: { id: 'test-bakery-product-id' },
    update: { bakeryId: bakery.id, deletedAt: null, isAvailable: true },
    create: {
      id: 'test-bakery-product-id',
      name: 'Sourdough Loaf',
      price: 3.5,
      itemType: 'bakery',
      bakeryId: bakery.id,
      categoryId: category.id,
      stockQuantity: 100,
      isAvailable: true,
    },
  });

  await prisma.product.upsert({
    where: { id: 'test-restaurant-product-id' },
    update: { restaurantId: restaurant.id, deletedAt: null, isAvailable: true },
    create: {
      id: 'test-restaurant-product-id',
      name: 'Shawarma Plate',
      price: 7.25,
      itemType: 'restaurant_menu',
      restaurantId: restaurant.id,
      stockQuantity: 50,
      isAvailable: true,
    },
  });

  const order = await prisma.order.upsert({
    where: { id: 'test-order-id' },
    update: { deletedAt: null, status: 'confirmed', paymentStatus: 'paid' },
    create: {
      id: 'test-order-id',
      userId: customer.id,
      bakeryId: bakery.id,
      orderNumber: 'KHB-TEST-001',
      status: 'confirmed',
      orderType: 'delivery',
      deliveryAddressId: address.id,
      totalAmount: 3.5,
      paymentMethod: 'cash_on_delivery',
      paymentStatus: 'paid',
    },
  });

  await prisma.driverProfile.upsert({
    where: { userId: driver.id },
    update: {
      status: 'online',
      vehicleType: 'motorbike',
      licensePlate: 'TEST-DRIVER-1',
    },
    create: {
      userId: driver.id,
      status: 'online',
      vehicleType: 'motorbike',
      licensePlate: 'TEST-DRIVER-1',
    },
  });

  await prisma.orderItem.upsert({
    where: { id: 'test-order-item-id' },
    update: {},
    create: {
      id: 'test-order-item-id',
      orderId: order.id,
      productId: bakeryProduct.id,
      quantity: 1,
      price: 3.5,
      subtotal: 3.5,
    },
  });

  const review = await prisma.review.upsert({
    where: { id: 'test-review-id' },
    update: { deletedAt: null },
    create: {
      id: 'test-review-id',
      userId: customer.id,
      rating: 5,
      comment: 'Great!',
      reviewType: 'product',
      productId: bakeryProduct.id,
    },
  });

  const notification = await prisma.notification.upsert({
    where: { id: 'test-notification-id' },
    update: {},
    create: {
      id: 'test-notification-id',
      userId: customer.id,
      title: 'Order Update',
      message: 'Your order is on the way',
      type: 'order',
      isRead: false,
    },
  });

  const adminToken = jwt.sign({ id: admin.id, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
  const bakeryToken = jwt.sign({ id: bakeryOwner.id, role: 'bakery_owner' }, JWT_SECRET, { expiresIn: '7d' });
  const restaurantToken = jwt.sign({ id: restaurantOwner.id, role: 'restaurant_owner' }, JWT_SECRET, { expiresIn: '7d' });
  const customerToken = jwt.sign({ id: customer.id, role: 'customer' }, JWT_SECRET, { expiresIn: '7d' });
  const driverToken = jwt.sign({ id: driver.id, role: 'driver' }, JWT_SECRET, { expiresIn: '7d' });

  const env = JSON.parse(fs.readFileSync(envPath, 'utf8'));
  const setVal = (key, val) => {
    const entry = env.values.find((v) => v.key === key);
    if (entry) entry.value = val; else env.values.push({ key, value: val, enabled: true });
  };

  setVal('base_url', 'http://localhost:3000');
  setVal('baseUrl', 'http://localhost:3000');
  setVal('auth_token', customerToken);
  setVal('authToken', customerToken);
  setVal('admin_token', adminToken);
  setVal('bakery_token', bakeryToken);
  setVal('restaurant_token', restaurantToken);
  setVal('customer_token', customerToken);
  setVal('driver_token', driverToken);
  setVal('userId', customer.id);
  setVal('addressId', address.id);
  setVal('bakeryId', bakery.id);
  setVal('restaurantId', restaurant.id);
  setVal('productId', bakeryProduct.id);
  setVal('orderId', order.id);
  setVal('notificationId', notification.id);
  setVal('reviewId', review.id);
  setVal('categoryId', category.id);

  fs.writeFileSync(envPath, JSON.stringify(env, null, 2));

  const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));

  const replacePlaceholders = (obj) => {
    if (typeof obj === 'string') {
      return obj
        .replace(/bakery_id_here/g, bakery.id)
        .replace(/restaurant_id_here/g, restaurant.id)
        .replace(/product_id_here/g, bakeryProduct.id)
        .replace(/order_id_here/g, order.id)
        .replace(/address_id_here/g, address.id)
        .replace(/notification_id_here/g, notification.id)
        .replace(/review_id_here/g, review.id)
        .replace(/category_id_here/g, category.id)
        .replace(/user_id_here/g, customer.id)
        .replace(/vendor_id_here/g, bakery.id);
    }
    if (Array.isArray(obj)) return obj.map(replacePlaceholders);
    if (obj && typeof obj === 'object') {
      const newObj = {};
      for (const k of Object.keys(obj)) newObj[k] = replacePlaceholders(obj[k]);
      return newObj;
    }
    return obj;
  };

  const addAuthHeaders = (item) => {
    if (!item || !item.request) return;
    const urlRaw = item.request.url?.raw || '';
    const setAuth = (tokenVar) => {
      item.request.header = item.request.header?.filter((h) => h.key.toLowerCase() !== 'authorization') || [];
      item.request.header.push({ key: 'Authorization', value: `Bearer {{${tokenVar}}}` });
    };

    if (urlRaw.includes('/api/admin')) {
      setAuth('admin_token');
    } else if (urlRaw.includes('/api/bakery') || urlRaw.includes('/api/bakeries')) {
      setAuth('bakery_token');
    } else if (urlRaw.includes('/api/restaurant') || urlRaw.includes('/api/restaurants')) {
      setAuth('restaurant_token');
    } else if (urlRaw.includes('/api/')) {
      setAuth('customer_token');
    }
  };

  const fixUploads = (item) => {
    if (!item.request || !item.request.body || item.request.body.mode !== 'formdata') return;
    if (item.name && item.name.includes('Upload')) {
      item.request.body.formdata = item.request.body.formdata.map((fd) => {
        if (fd.type === 'file') {
          return { ...fd, src: [sampleFile] };
        }
        return fd;
      });
    }
  };

  const walkItems = (items) => {
    items.forEach((it) => {
      addAuthHeaders(it);
      fixUploads(it);
      if (it.request) it.request = replacePlaceholders(it.request);
      if (it.item) walkItems(it.item);
    });
  };

  walkItems(collection.item);
  fs.writeFileSync(collectionPath, JSON.stringify(collection, null, 2));

  return { adminToken, ids: { address: address.id, bakery: bakery.id, restaurant: restaurant.id, product: bakeryProduct.id, order: order.id, notification: notification.id, review: review.id } };
}

seed()
  .then((res) => {
    console.log('Seed complete');
    console.log(res);
    return prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
