process.env.NODE_ENV = 'test';
require('dotenv').config();

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');

const secret = process.env.JWT_SECRET || 'dev-temp-secret-change-me';
const tokenFor = (user) =>
  jwt.sign({ id: user.id, role: user.role }, secret, { expiresIn: '2h' });
const unique = (prefix) =>
  `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;

describe.each([
  {
    type: 'restaurant',
    ownerRole: 'restaurant_owner',
    otherRole: 'restaurant_owner',
    vendorPath: '/v1/restaurants',
    ownerPath: '/v1/restaurants',
    productPath: '/v1/restaurant/products',
    categoryPath: '/v1/restaurant/categories',
    vendorModel: 'restaurant',
    vendorIdField: 'restaurantId',
    itemType: 'restaurant_menu',
  },
  {
    type: 'bakery',
    ownerRole: 'bakery_owner',
    otherRole: 'bakery_owner',
    vendorPath: '/v1/bakeries',
    ownerPath: '/v1/bakery',
    productPath: '/v1/bakery/products',
    categoryPath: '/v1/bakery/categories',
    vendorModel: 'bakery',
    vendorIdField: 'bakeryId',
    itemType: 'bakery',
  },
])('isolated $type lifecycle rehearsal', (config) => {
  const ids = {
    users: [],
    vendors: [],
    categories: [],
    products: [],
    groups: [],
    orders: [],
    addresses: [],
  };
  let admin;
  let owner;
  let otherOwner;
  let crossOwner;
  let customer;
  let driver;
  let vendor;
  let category;
  let product;
  let requiredGroup;
  let optionalGroup;
  let requiredOption;
  let optionalOption;
  let mixedVendorProduct;
  let order;
  let historicalSnapshot;

  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const selected = (token, vendorId = vendor.id) => ({
    ...auth(token),
    'X-Vendor-ID': vendorId,
    'X-Vendor-Type': config.type,
  });

  beforeAll(async () => {
    const stamp = unique(config.type);
    const users = await Promise.all([
      ['admin', 'admin'],
      ['owner', config.ownerRole],
      ['other', config.otherRole],
      ['cross', config.type === 'bakery' ? 'restaurant_owner' : 'bakery_owner'],
      ['customer', 'customer'],
      ['driver', 'driver'],
    ].map(([label, role], index) =>
      prisma.user.create({
        data: {
          username: `${stamp}_${label}`,
          email: `${stamp}_${label}@example.com`,
          phoneNumber: `+9627${index}${String(Date.now()).slice(-7)}`,
          password: 'test-only',
          fullName: `${config.type} ${label}`,
          role,
          isVerified: true,
        },
      })));
    [admin, owner, otherOwner, crossOwner, customer, driver] = users;
    ids.users.push(...users.map(({ id }) => id));

    await prisma.driverProfile.create({
      data: {
        userId: driver.id,
        status: 'online',
        vehicleType: 'motorbike',
        licensePlate: unique('plate'),
      },
    });
    const address = await prisma.address.create({
      data: {
        userId: customer.id,
        addressLine1: `${config.type} rehearsal street`,
        city: 'Amman',
        postalCode: '11118',
        country: 'Jordan',
        isDefault: true,
      },
    });
    ids.addresses.push(address.id);

    const register = await request(app)
      .post(config.vendorPath)
      .set(auth(tokenFor(owner)))
      .send({
        name: unique(`${config.type}_vendor`),
        description: 'Isolated launch rehearsal',
        cuisineType: config.type === 'restaurant' ? 'Levantine' : undefined,
        addressLine1: 'Launch Street',
        city: 'Amman',
        postalCode: '11118',
        country: 'Jordan',
        phoneNumber: '+962790009999',
        email: owner.email,
      });
    expect(register.status).toBe(201);
    vendor = register.body.data[config.vendorModel];
    ids.vendors.push(vendor.id);
    expect(vendor.status).toBe('pending_approval');

    const initial = await request(app)
      .get('/v1/auth/approval-status')
      .set(auth(tokenFor(owner)));
    expect(initial.status).toBe(200);
    expect(initial.body.data.vendorStatus.vendorPending).toBe(true);

    const approve = await request(app)
      .put(`/v1/admin/vendors/${vendor.id}/approve`)
      .set(auth(tokenFor(admin)));
    expect(approve.status).toBe(200);

    const refreshed = await request(app)
      .get(`/v1/auth/approval-status?vendorId=${vendor.id}`)
      .set(auth(tokenFor(owner)));
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.vendorStatus.currentVendorId).toBe(vendor.id);
    expect(refreshed.body.data.vendorStatus.vendorApproved).toBe(true);
  });

  afterAll(async () => {
    await prisma.notificationJob.deleteMany({
      where: { OR: [{ userId: { in: ids.users } }, { payload: { path: ['orderId'], string_contains: '' } }] },
    }).catch(() => null);
    await prisma.notification.deleteMany({ where: { userId: { in: ids.users } } }).catch(() => null);
    await prisma.deliveryAssignment.deleteMany({ where: { orderId: { in: ids.orders } } }).catch(() => null);
    await prisma.dispatchJob.deleteMany({ where: { orderId: { in: ids.orders } } }).catch(() => null);
    await prisma.inventoryMovement.deleteMany({ where: { orderId: { in: ids.orders } } }).catch(() => null);
    await prisma.orderFinancialRecord.deleteMany({ where: { orderId: { in: ids.orders } } }).catch(() => null);
    await prisma.financialTransaction.deleteMany({ where: { orderId: { in: ids.orders } } }).catch(() => null);
    await prisma.orderIdempotencyKey.deleteMany({ where: { orderId: { in: ids.orders } } }).catch(() => null);
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids.orders } } }).catch(() => null);
    await prisma.order.deleteMany({ where: { id: { in: ids.orders } } }).catch(() => null);
    await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: ids.users } } } }).catch(() => null);
    await prisma.cart.deleteMany({ where: { userId: { in: ids.users } } }).catch(() => null);
    await prisma.modifierOption.deleteMany({ where: { modifierGroupId: { in: ids.groups } } }).catch(() => null);
    await prisma.modifierGroup.deleteMany({ where: { id: { in: ids.groups } } }).catch(() => null);
    await prisma.product.deleteMany({ where: { id: { in: ids.products } } }).catch(() => null);
    await prisma.category.deleteMany({ where: { id: { in: ids.categories } } }).catch(() => null);
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorUserId: { in: ids.users } }, { entityId: { in: [...ids.vendors, ...ids.orders] } }] },
    }).catch(() => null);
    await prisma.driverProfile.deleteMany({ where: { userId: { in: ids.users } } }).catch(() => null);
    await prisma.address.deleteMany({ where: { id: { in: ids.addresses } } }).catch(() => null);
    await prisma.bakery.deleteMany({ where: { ownerId: { in: ids.users } } }).catch(() => null);
    await prisma.restaurant.deleteMany({ where: { ownerId: { in: ids.users } } }).catch(() => null);
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } }).catch(() => null);
  });

  test('creates catalog and modifiers under explicit selected context', async () => {
    const categoryResponse = await request(app)
      .post(config.categoryPath)
      .set(selected(tokenFor(owner)))
      .send({ name: unique(`${config.type}_category`), description: 'Lifecycle category' });
    expect(categoryResponse.status).toBe(201);
    category = categoryResponse.body.data;
    ids.categories.push(category.id);

    const productResponse = await request(app)
      .post(config.productPath)
      .set(selected(tokenFor(owner)))
      .send({
        name: `${config.type} immutable product`,
        description: 'Lifecycle product',
        imageUrl: `/uploads/${config.type}-original.png`,
        price: 10,
        stockQuantity: 50,
        categoryId: category.id,
      });
    expect(productResponse.status).toBe(201);
    product = productResponse.body.data.product || productResponse.body.data;
    ids.products.push(product.id);

    const createGroup = async (payload) => {
      const response = await request(app)
        .post(`/v1/products/${product.id}/modifier-groups`)
        .set(selected(tokenFor(owner)))
        .send(payload);
      expect(response.status).toBe(201);
      ids.groups.push(response.body.data.modifierGroup.id);
      return response.body.data.modifierGroup;
    };
    requiredGroup = await createGroup({
      nameEn: 'Required size',
      nameAr: 'الحجم المطلوب',
      selectionType: 'single',
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
    });
    optionalGroup = await createGroup({
      nameEn: 'Optional extras',
      nameAr: 'إضافات اختيارية',
      selectionType: 'multiple',
      isRequired: false,
      minSelections: 0,
      maxSelections: 2,
    });
    const createOption = async (group, name, adjustment) => {
      const response = await request(app)
        .post(`/v1/products/${product.id}/modifier-groups/${group.id}/options`)
        .set(selected(tokenFor(owner)))
        .send({ nameEn: name, nameAr: name, priceAdjustment: adjustment });
      expect(response.status).toBe(201);
      return response.body.data.modifierOption;
    };
    requiredOption = await createOption(requiredGroup, 'Large', 2);
    optionalOption = await createOption(optionalGroup, 'Premium topping', 1.5);

    const serialized = await request(app)
      .get(`/v1/products/${product.id}/modifier-groups`);
    expect(serialized.status).toBe(200);
    expect(serialized.body.data.modifierGroups).toHaveLength(2);

    const secondVendorResponse = await request(app)
      .post(config.vendorPath)
      .set(auth(tokenFor(otherOwner)))
      .send({
        name: unique(`${config.type}_mixed_vendor`),
        description: 'Mixed-vendor rejection fixture',
        cuisineType: config.type === 'restaurant' ? 'Levantine' : undefined,
        addressLine1: 'Isolation Street',
        city: 'Amman',
        postalCode: '11118',
        country: 'Jordan',
        phoneNumber: '+962790008888',
        email: otherOwner.email,
      });
    expect(secondVendorResponse.status).toBe(201);
    const secondVendor = secondVendorResponse.body.data[config.vendorModel];
    ids.vendors.push(secondVendor.id);
    const secondApproval = await request(app)
      .put(`/v1/admin/vendors/${secondVendor.id}/approve`)
      .set(auth(tokenFor(admin)));
    expect(secondApproval.status).toBe(200);
    const secondCategoryResponse = await request(app)
      .post(config.categoryPath)
      .set(selected(tokenFor(otherOwner), secondVendor.id))
      .send({ name: unique(`${config.type}_mixed_category`) });
    expect(secondCategoryResponse.status).toBe(201);
    ids.categories.push(secondCategoryResponse.body.data.id);
    const secondProductResponse = await request(app)
      .post(config.productPath)
      .set(selected(tokenFor(otherOwner), secondVendor.id))
      .send({
        name: `${config.type} mixed-vendor product`,
        price: 4,
        stockQuantity: 5,
        categoryId: secondCategoryResponse.body.data.id,
      });
    expect(secondProductResponse.status).toBe(201);
    mixedVendorProduct = secondProductResponse.body.data.product || secondProductResponse.body.data;
    ids.products.push(mixedVendorProduct.id);
  });

  test('proves discovery, authenticated cart, authoritative checkout, and boundaries', async () => {
    const discovery = await request(app).get(config.vendorPath);
    expect(discovery.status).toBe(200);
    expect(JSON.stringify(discovery.body)).toContain(vendor.id);

    const cartAdd = await request(app)
      .post('/v1/customer/cart/items')
      .set(auth(tokenFor(customer)))
      .send({
        productId: product.id,
        quantity: 2,
        selectedModifierOptionIds: [requiredOption.id, optionalOption.id],
      });
    expect(cartAdd.status).toBe(201);
    expect(Number(cartAdd.body.data.cart.totalAmount)).toBe(27);
    const synchronized = await request(app)
      .get('/v1/customer/cart')
      .set(auth(tokenFor(customer)));
    expect(synchronized.status).toBe(200);
    expect(synchronized.body.data.cart.cartItems).toHaveLength(1);

    const mixedVendorAdd = await request(app)
      .post('/v1/customer/cart/items')
      .set(auth(tokenFor(customer)))
      .send({ productId: mixedVendorProduct.id, quantity: 1 });
    expect(mixedVendorAdd.status).toBe(409);

    const badModifier = await request(app)
      .post('/v1/orders')
      .set(auth(tokenFor(customer)))
      .send({
        orderType: 'delivery',
        deliveryAddressId: ids.addresses[0],
        paymentMethod: 'CASH_ON_DELIVERY',
        items: [{
          productId: product.id,
          quantity: 1,
          selectedModifierOptionIds: [
            requiredOption.id,
            '00000000-0000-0000-0000-000000000000',
          ],
        }],
      });
    expect(badModifier.status).toBe(400);

    const payload = {
      orderType: 'delivery',
      deliveryAddressId: ids.addresses[0],
      paymentMethod: 'CASH_ON_DELIVERY',
      totalAmount: 0.01,
      items: [{
        productId: product.id,
        quantity: 2,
        price: 0.01,
        selectedModifierOptionIds: [requiredOption.id, optionalOption.id],
      }],
    };
    const idempotencyKey = unique(`${config.type}_order`);
    const checkout = await request(app)
      .post('/v1/orders')
      .set(auth(tokenFor(customer)))
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);
    expect(checkout.status).toBe(201);
    order = checkout.body.data.order;
    ids.orders.push(order.id);
    expect(Number(order.totalAmount)).toBe(28);

    const duplicate = await request(app)
      .post('/v1/orders')
      .set(auth(tokenFor(customer)))
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);
    expect([200, 201]).toContain(duplicate.status);
    expect(duplicate.body.data.order.id).toBe(order.id);

    const item = await prisma.orderItem.findFirst({ where: { orderId: order.id } });
    expect(Number(item.unitPriceSnapshot)).toBe(13.5);
    expect(Number(item.modifierAdjustmentSnapshot)).toBe(3.5);
    expect(Number(item.itemTotalSnapshot)).toBe(27);
    expect(item.productNameSnapshot).toBe(`${config.type} immutable product`);
    expect(item.productImageSnapshot).toBe(`/uploads/${config.type}-original.png`);
    expect(item.vendorIdSnapshot).toBe(vendor.id);
    expect(item.vendorTypeSnapshot).toBe(config.type);
    expect(item.selectedModifiersSnapshot).toHaveLength(2);
    historicalSnapshot = JSON.stringify({
      productNameSnapshot: item.productNameSnapshot,
      productImageSnapshot: item.productImageSnapshot,
      vendorIdSnapshot: item.vendorIdSnapshot,
      vendorTypeSnapshot: item.vendorTypeSnapshot,
      selectedModifiersSnapshot: item.selectedModifiersSnapshot,
      unitPriceSnapshot: item.unitPriceSnapshot,
      itemTotalSnapshot: item.itemTotalSnapshot,
    });

    const ownerOrders = await request(app)
      .get(`${config.ownerPath}/orders`)
      .set(selected(tokenFor(owner)));
    expect(ownerOrders.status).toBe(200);
    expect(JSON.stringify(ownerOrders.body)).toContain(order.id);

    const wrongContext = await request(app)
      .get(`${config.ownerPath}/orders`)
      .set(selected(tokenFor(owner), '00000000-0000-0000-0000-000000000000'));
    expect([403, 404]).toContain(wrongContext.status);
    expect(JSON.stringify(wrongContext.body)).not.toContain(order.id);

    const otherOrder = await request(app)
      .get(`${config.ownerPath}/orders/${order.id}`)
      .set(auth(tokenFor(otherOwner)));
    expect([403, 404]).toContain(otherOrder.status);

    const crossMutation = await request(app)
      .put(`${config.productPath}/${product.id}`)
      .set(auth(tokenFor(crossOwner)))
      .send({ name: 'Cross-owner mutation' });
    expect(crossMutation.status).toBe(403);
  });

  test('runs owner and isolated driver state machines to delivery', async () => {
    const updateStatus = (status) =>
      request(app)
        .put(`${config.ownerPath}/orders/${order.id}/status`)
        .set(selected(tokenFor(owner)))
        .send({ status });
    expect(order.status).toBe('confirmed');
    for (const status of ['preparing', 'ready_for_pickup']) {
      const response = await updateStatus(status);
      expect(response.status).toBe(200);
    }

    const invalid = await updateStatus('confirmed');
    expect(invalid.status).toBe(409);

    const available = await request(app)
      .get('/v1/driver/available-deliveries')
      .set(auth(tokenFor(driver)));
    expect(available.status).toBe(200);
    expect(JSON.stringify(available.body)).toContain(order.id);

    const accept = await request(app)
      .post(`/v1/driver/assignments/${order.id}/accept`)
      .set(auth(tokenFor(driver)))
      .send({});
    expect(accept.status).toBe(200);
    for (const status of ['picked_up', 'out_for_delivery', 'delivered']) {
      const response = await request(app)
        .post(`/v1/driver/assignments/${order.id}/status`)
        .set(auth(tokenFor(driver)))
        .send({
          status,
          ...(status === 'delivered'
            ? { proofImageUrl: `/uploads/${config.type}-proof.png` }
            : {}),
        });
      expect(response.status).toBe(200);
    }

    const customerView = await request(app)
      .get(`/v1/orders/${order.id}`)
      .set(auth(tokenFor(customer)));
    expect(customerView.status).toBe(200);
    expect(JSON.stringify(customerView.body)).toContain('delivered');

    const adminView = await request(app)
      .get(`/v1/admin/orders/${order.id}`)
      .set(auth(tokenFor(admin)));
    expect(adminView.status).toBe(200);
    const persisted = await prisma.order.findUnique({
      where: { id: order.id },
      include: { deliveryAssignment: true },
    });
    expect(persisted.status).toBe('delivered');
    expect(persisted[config.vendorIdField]).toBe(vendor.id);
    expect(persisted.userId).toBe(customer.id);
    expect(persisted.deliveryAssignment.driverId).toBe(
      (await prisma.driverProfile.findUnique({ where: { userId: driver.id } })).id,
    );
    expect(Number(persisted.totalAmount)).toBe(28);
  });

  test('preserves historical snapshots and rejects suspended mutations', async () => {
    await prisma.product.update({
      where: { id: product.id },
      data: {
        name: `${config.type} changed live product`,
        imageUrl: `/uploads/${config.type}-changed.png`,
        deletedAt: new Date(),
      },
    });
    await prisma.modifierOption.update({
      where: { id: requiredOption.id },
      data: {
        nameEn: 'Changed live option',
        priceAdjustment: 99,
        isAvailable: false,
        deletedAt: new Date(),
      },
    });
    const historical = await prisma.orderItem.findFirst({ where: { orderId: order.id } });
    expect(JSON.stringify({
      productNameSnapshot: historical.productNameSnapshot,
      productImageSnapshot: historical.productImageSnapshot,
      vendorIdSnapshot: historical.vendorIdSnapshot,
      vendorTypeSnapshot: historical.vendorTypeSnapshot,
      selectedModifiersSnapshot: historical.selectedModifiersSnapshot,
      unitPriceSnapshot: historical.unitPriceSnapshot,
      itemTotalSnapshot: historical.itemTotalSnapshot,
    })).toBe(historicalSnapshot);

    await prisma[config.vendorModel].update({
      where: { id: vendor.id },
      data: { status: 'suspended' },
    });
    const suspended = await request(app)
      .post(config.productPath)
      .set(selected(tokenFor(owner)))
      .send({
        name: 'Blocked suspended product',
        price: 1,
        stockQuantity: 1,
      });
    expect(suspended.status).toBe(403);

    const approvalAudit = await prisma.auditLog.findFirst({
      where: {
        action: 'vendor.approved',
        entityId: vendor.id,
        actorUserId: admin.id,
      },
    });
    expect(approvalAudit).toBeTruthy();
    const assignment = await prisma.deliveryAssignment.findUnique({
      where: { orderId: order.id },
    });
    console.log('LIFECYCLE_EVIDENCE', JSON.stringify({
      vendorType: config.type,
      fixtureIds: {
        admin: admin.id,
        owner: owner.id,
        otherOwner: otherOwner.id,
        crossOwner: crossOwner.id,
        customer: customer.id,
        driver: driver.id,
        vendor: vendor.id,
        category: category.id,
        product: product.id,
        requiredGroup: requiredGroup.id,
        optionalGroup: optionalGroup.id,
        requiredOption: requiredOption.id,
        optionalOption: optionalOption.id,
        address: ids.addresses[0],
        order: order.id,
        assignment: assignment.id,
        approvalAudit: approvalAudit.id,
      },
      selectedVendorContext: {
        vendorId: vendor.id,
        vendorType: config.type,
      },
      totals: {
        baseUnitPrice: 10,
        modifierAdjustment: 3.5,
        unitPrice: 13.5,
        quantity: 2,
        subtotal: 27,
        deliveryFee: 1,
        finalTotal: 28,
      },
      transitions: [
        'confirmed',
        'preparing',
        'ready_for_pickup',
        'picked_up',
        'out_for_delivery',
        'delivered',
      ],
      finalState: 'delivered',
      paymentMethod: 'cash_on_delivery',
      snapshotPreserved: true,
      cleanupRunsInAfterAll: true,
    }));
  });
});
