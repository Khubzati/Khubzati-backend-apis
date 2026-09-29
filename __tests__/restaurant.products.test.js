process.env.NODE_ENV = 'test';
require('dotenv').config();

const { execSync } = require('child_process');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');

jest.setTimeout(15000);

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';

const asToken = (user) =>
  jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1h' });

// Covers the Phase 4b fix: restaurants.js had no PUT/DELETE/PATCH-availability
// routes for /restaurant/products/:id and no /restaurant/categories routes at
// all, so every restaurant-owner edit/delete/availability-toggle/category
// action 404d in production (IMPLEMENTATION_MATRIX.md §2 blocker #3). Also
// covers the category_id/categoryId query-param mismatch found while fixing
// that (the Flutter client sends snake_case `category_id`, the route only
// read camelCase `categoryId`).
describe('Restaurant product & category management', () => {
  let restaurantOwner;
  let restaurantOwnerToken;
  let restaurantId;
  const createdProductIds = [];
  const createdCategoryIds = [];
  const tempRestaurantIds = [];

  beforeAll(async () => {
    execSync('node scripts/test-setup.js', { stdio: 'inherit', cwd: process.cwd() });
    restaurantOwner = await prisma.user.findUnique({ where: { email: 'restaurant_owner@example.com' } });
    restaurantOwnerToken = asToken(restaurantOwner);
    const restaurant = await prisma.restaurant.findUnique({ where: { id: 'test-restaurant-id' } });
    restaurantId = restaurant.id;
    // test-setup seeds this row as approved; re-assert it so it's the most
    // recently updated restaurant for this owner (resolveManagedRestaurant
    // orders by updatedAt desc), independent of test execution order.
    await prisma.restaurant.update({ where: { id: restaurantId }, data: { status: 'approved', deletedAt: null } });
  });

  afterEach(async () => {
    if (createdProductIds.length) {
      const ids = createdProductIds.splice(0);
      await prisma.product.deleteMany({ where: { id: { in: ids } } });
    }
    if (createdCategoryIds.length) {
      const ids = createdCategoryIds.splice(0);
      await prisma.category.deleteMany({ where: { id: { in: ids } } });
    }
    if (tempRestaurantIds.length) {
      const ids = tempRestaurantIds.splice(0);
      await prisma.product.deleteMany({ where: { restaurantId: { in: ids } } });
      await prisma.restaurant.deleteMany({ where: { id: { in: ids } } });
    }
  });

  const createProduct = async (overrides = {}) => {
    const product = await prisma.product.create({
      data: {
        name: 'Temp Menu Item',
        price: 5,
        itemType: 'restaurant_menu',
        restaurantId,
        stockQuantity: 10,
        isAvailable: true,
        ...overrides,
      },
    });
    createdProductIds.push(product.id);
    return product;
  };

  describe('POST /restaurant/products', () => {
    test('creates a product for the requesting restaurant owner', async () => {
      const category = await prisma.category.create({
        data: { name: 'Create Category', type: 'restaurant', createdBy: restaurantOwner.id },
      });
      createdCategoryIds.push(category.id);

      const res = await request(app)
        .post('/v1/restaurant/products')
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({
          name: 'New Product',
          description: 'Fresh and ready',
          price: 7.25,
          categoryId: category.id,
          stockQuantity: 8,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('New Product');
      expect(res.body.data.restaurantId).toBe(restaurantId);
      createdProductIds.push(res.body.data.id);
    });

    test('accepts the legacy category_id payload field for active Flutter compatibility', async () => {
      const category = await prisma.category.create({
        data: { name: 'Legacy Payload Category', type: 'restaurant', createdBy: restaurantOwner.id },
      });
      createdCategoryIds.push(category.id);

      const res = await request(app)
        .post('/v1/restaurant/products')
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({
          name: 'Legacy Field Product',
          price: 6,
          category_id: category.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.categoryId).toBe(category.id);
      createdProductIds.push(res.body.data.id);
    });

    test('rejects invalid payloads', async () => {
      const res = await request(app)
        .post('/v1/restaurant/products')
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({
          name: '',
          price: -1,
          stockQuantity: 'lots',
        });

      expect(res.status).toBe(400);
    });

    test('rejects conflicting categoryId and category_id values', async () => {
      const firstCategory = await prisma.category.create({
        data: { name: 'Conflict A', type: 'restaurant', createdBy: restaurantOwner.id },
      });
      const secondCategory = await prisma.category.create({
        data: { name: 'Conflict B', type: 'restaurant', createdBy: restaurantOwner.id },
      });
      createdCategoryIds.push(firstCategory.id, secondCategory.id);

      const res = await request(app)
        .post('/v1/restaurant/products')
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({
          name: 'Conflict Product',
          price: 4,
          categoryId: firstCategory.id,
          category_id: secondCategory.id,
        });

      expect(res.status).toBe(400);
    });

    test('blocks writes for a non-approved restaurant owner with 403', async () => {
      const suspended = await prisma.restaurant.create({
        data: {
          ownerId: restaurantOwner.id,
          name: 'Suspended Product Create Restaurant',
          addressLine1: 'Test address',
          city: 'Amman',
          postalCode: '00000',
          country: 'Jordan',
          phoneNumber: '0700000001',
          status: 'rejected',
          createdBy: restaurantOwner.id,
        },
      });
      tempRestaurantIds.push(suspended.id);

      const res = await request(app)
        .post('/v1/restaurant/products')
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({ name: 'Blocked', price: 4 });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/not active/i);
    });
  });

  describe('PUT /restaurant/products/:id', () => {
    test('updates a product owned by the requesting restaurant', async () => {
      const product = await createProduct({ name: 'Old Name', price: 4 });

      const res = await request(app)
        .put(`/v1/restaurant/products/${product.id}`)
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({ name: 'New Name', price: 9.5 });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('New Name');
      expect(Number(res.body.data.price)).toBeCloseTo(9.5);

      const updated = await prisma.product.findUnique({ where: { id: product.id } });
      expect(updated.name).toBe('New Name');
    });

    test('rejects an invalid price', async () => {
      const product = await createProduct();

      const res = await request(app)
        .put(`/v1/restaurant/products/${product.id}`)
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({ price: 'not-a-number' });

      expect(res.status).toBe(400);
    });

    test('accepts the legacy category_id payload field on update', async () => {
      const firstCategory = await prisma.category.create({
        data: { name: 'Update Category A', type: 'restaurant', createdBy: restaurantOwner.id },
      });
      const secondCategory = await prisma.category.create({
        data: { name: 'Update Category B', type: 'restaurant', createdBy: restaurantOwner.id },
      });
      createdCategoryIds.push(firstCategory.id, secondCategory.id);
      const product = await createProduct({ categoryId: firstCategory.id });

      const res = await request(app)
        .put(`/v1/restaurant/products/${product.id}`)
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({ category_id: secondCategory.id });

      expect(res.status).toBe(200);
      expect(res.body.data.categoryId).toBe(secondCategory.id);
    });

    test('returns 404 for a non-existent product', async () => {
      const res = await request(app)
        .put('/v1/restaurant/products/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({ name: 'Nope' });

      expect(res.status).toBe(404);
    });

    test('blocks updating a product owned by a different vendor', async () => {
      const res = await request(app)
        .put('/v1/restaurant/products/test-bakery-product-id')
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({ name: 'Hijacked' });

      expect(res.status).toBe(403);
      const bakeryProduct = await prisma.product.findUnique({ where: { id: 'test-bakery-product-id' } });
      expect(bakeryProduct.name).not.toBe('Hijacked');
    });

    test('blocks writes for a non-approved (suspended) restaurant owner', async () => {
      const suspended = await prisma.restaurant.create({
        data: {
          ownerId: restaurantOwner.id,
          name: 'Suspended Restaurant',
          addressLine1: 'Test address',
          city: 'Amman',
          postalCode: '00000',
          country: 'Jordan',
          phoneNumber: '0700000000',
          // Suspension reuses the `rejected` status — there is no distinct
          // `suspended` value in RestaurantStatus (see admin.js suspend route).
          status: 'rejected',
          createdBy: restaurantOwner.id,
        },
      });
      tempRestaurantIds.push(suspended.id);

      const product = await createProduct({ restaurantId: suspended.id });

      const res = await request(app)
        .put(`/v1/restaurant/products/${product.id}`)
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({ name: 'Should be blocked' });

      expect(res.status).toBe(403);
      const unchanged = await prisma.product.findUnique({ where: { id: product.id } });
      expect(unchanged.name).toBe('Temp Menu Item');
    });
  });

  describe('DELETE /restaurant/products/:id', () => {
    test('soft-deletes a product owned by the requesting restaurant', async () => {
      const product = await createProduct();

      const res = await request(app)
        .delete(`/v1/restaurant/products/${product.id}`)
        .set('Authorization', `Bearer ${restaurantOwnerToken}`);

      expect(res.status).toBe(200);
      const deleted = await prisma.product.findUnique({ where: { id: product.id } });
      expect(deleted.deletedAt).not.toBeNull();
    });

    test('blocks deleting a product owned by a different vendor', async () => {
      const res = await request(app)
        .delete('/v1/restaurant/products/test-bakery-product-id')
        .set('Authorization', `Bearer ${restaurantOwnerToken}`);

      expect(res.status).toBe(403);
      const bakeryProduct = await prisma.product.findUnique({ where: { id: 'test-bakery-product-id' } });
      expect(bakeryProduct.deletedAt).toBeNull();
    });
  });

  describe('PATCH /restaurant/products/:id/availability', () => {
    test('toggles availability off and on', async () => {
      const product = await createProduct({ isAvailable: true });

      const off = await request(app)
        .patch(`/v1/restaurant/products/${product.id}/availability`)
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({ is_available: false });
      expect(off.status).toBe(200);
      expect(off.body.data.isAvailable).toBe(false);

      const on = await request(app)
        .patch(`/v1/restaurant/products/${product.id}/availability`)
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({ is_available: true });
      expect(on.status).toBe(200);
      expect(on.body.data.isAvailable).toBe(true);
    });

    test('rejects a non-boolean availability value', async () => {
      const product = await createProduct();

      const res = await request(app)
        .patch(`/v1/restaurant/products/${product.id}/availability`)
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({ is_available: 'maybe' });

      expect(res.status).toBe(400);
    });

    test('blocks toggling a product owned by a different vendor', async () => {
      const res = await request(app)
        .patch('/v1/restaurant/products/test-bakery-product-id/availability')
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({ is_available: false });

      expect(res.status).toBe(403);
    });
  });

  describe('Category CRUD', () => {
    test('creates, lists, updates, and deletes a category', async () => {
      const createRes = await request(app)
        .post('/v1/restaurant/categories')
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({ name: 'Grill', description: 'Grilled items' });

      expect(createRes.status).toBe(201);
      expect(createRes.body.data.type).toBe('restaurant');
      const categoryId = createRes.body.data.id;
      createdCategoryIds.push(categoryId);

      const listRes = await request(app)
        .get('/v1/restaurant/categories')
        .set('Authorization', `Bearer ${restaurantOwnerToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.some((c) => c.id === categoryId)).toBe(true);

      const updateRes = await request(app)
        .put(`/v1/restaurant/categories/${categoryId}`)
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({ name: 'Grill House' });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.name).toBe('Grill House');

      const deleteRes = await request(app)
        .delete(`/v1/restaurant/categories/${categoryId}`)
        .set('Authorization', `Bearer ${restaurantOwnerToken}`);
      expect(deleteRes.status).toBe(200);

      const afterDelete = await prisma.category.findUnique({ where: { id: categoryId } });
      expect(afterDelete.deletedAt).not.toBeNull();
    });

    test('rejects category creation without a name', async () => {
      const res = await request(app)
        .post('/v1/restaurant/categories')
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({ description: 'No name given' });

      expect(res.status).toBe(400);
    });

    test('blocks updating or deleting a category owned by another vendor', async () => {
      const foreignCategory = await prisma.category.create({
        data: {
          name: 'Foreign Category',
          type: 'restaurant',
          createdBy: '00000000-0000-0000-0000-000000000123',
        },
      });
      createdCategoryIds.push(foreignCategory.id);

      const updateRes = await request(app)
        .put(`/v1/restaurant/categories/${foreignCategory.id}`)
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({ name: 'Hijacked Category' });
      expect(updateRes.status).toBe(403);

      const deleteRes = await request(app)
        .delete(`/v1/restaurant/categories/${foreignCategory.id}`)
        .set('Authorization', `Bearer ${restaurantOwnerToken}`);
      expect(deleteRes.status).toBe(403);
    });

    test('blocks category deletion while products still reference it', async () => {
      const category = await prisma.category.create({
        data: { name: 'Category In Use', type: 'restaurant', createdBy: restaurantOwner.id },
      });
      createdCategoryIds.push(category.id);
      await createProduct({ categoryId: category.id });

      const res = await request(app)
        .delete(`/v1/restaurant/categories/${category.id}`)
        .set('Authorization', `Bearer ${restaurantOwnerToken}`);

      expect(res.status).toBe(409);
    });

    test('blocks category writes for a non-approved restaurant owner', async () => {
      const suspended = await prisma.restaurant.create({
        data: {
          ownerId: restaurantOwner.id,
          name: 'Suspended Category Restaurant',
          addressLine1: 'Test address',
          city: 'Amman',
          postalCode: '00000',
          country: 'Jordan',
          phoneNumber: '0700000002',
          status: 'pending_approval',
          createdBy: restaurantOwner.id,
        },
      });
      tempRestaurantIds.push(suspended.id);

      const res = await request(app)
        .post('/v1/restaurant/categories')
        .set('Authorization', `Bearer ${restaurantOwnerToken}`)
        .send({ name: 'Blocked Category' });

      expect(res.status).toBe(403);
    });

    test('does not list bakery-only categories', async () => {
      const bakeryOnlyCategory = await prisma.category.create({
        data: { name: 'Bakery Only Category', type: 'bakery' },
      });
      createdCategoryIds.push(bakeryOnlyCategory.id);

      const res = await request(app)
        .get('/v1/restaurant/categories')
        .set('Authorization', `Bearer ${restaurantOwnerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.some((c) => c.id === bakeryOnlyCategory.id)).toBe(false);
    });
  });

  describe('categoryId / category_id query param compatibility', () => {
    test('filters the product list using the snake_case category_id param the Flutter client sends', async () => {
      const category = await prisma.category.create({ data: { name: 'Filter Category', type: 'restaurant' } });
      createdCategoryIds.push(category.id);
      const matching = await createProduct({ name: 'In Category', categoryId: category.id });
      await createProduct({ name: 'Not In Category' });

      const res = await request(app)
        .get('/v1/restaurant/products')
        .query({ category_id: category.id })
        .set('Authorization', `Bearer ${restaurantOwnerToken}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.products.map((p) => p.id);
      expect(ids).toContain(matching.id);
      expect(ids.length).toBe(1);
    });

    test('accepts the camelCase categoryId query param too', async () => {
      const category = await prisma.category.create({
        data: { name: 'Camel Filter Category', type: 'restaurant', createdBy: restaurantOwner.id },
      });
      createdCategoryIds.push(category.id);
      const matching = await createProduct({ name: 'Camel Match', categoryId: category.id });
      await createProduct({ name: 'Camel Miss' });

      const res = await request(app)
        .get('/v1/restaurant/products')
        .query({ categoryId: category.id })
        .set('Authorization', `Bearer ${restaurantOwnerToken}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.products.map((p) => p.id);
      expect(ids).toContain(matching.id);
      expect(ids.length).toBe(1);
    });
  });
});
