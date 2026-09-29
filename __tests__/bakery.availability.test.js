process.env.NODE_ENV = 'test';
require('dotenv').config();

const { execSync } = require('child_process');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');

jest.setTimeout(10000);

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';

const makeToken = async (role, email) => {
  const user = await prisma.user.findFirst({ where: { email } });
  return jwt.sign({ id: user.id, role }, JWT_SECRET, { expiresIn: '1h' });
};

describe('Bakery product availability', () => {
  let bakeryToken;
  let bakeryId;
  const productId = 'test-bakery-product-id';

  beforeAll(async () => {
    execSync('node scripts/test-setup.js', { stdio: 'inherit', cwd: process.cwd() });
    bakeryToken = await makeToken('bakery_owner', 'bakery_owner@example.com');
    const bakery = await prisma.bakery.findFirst({ where: { id: 'test-bakery-id' } });
    bakeryId = bakery.id;
    await prisma.product.update({
      where: { id: productId },
      data: { deletedAt: null, isAvailable: true },
    });
  });

  afterAll(async () => {
  });

  test('allows bakery owner to toggle availability for own product', async () => {
    const res = await request(app)
      .patch(`/api/bakery/products/${productId}/availability`)
      .set('Authorization', `Bearer ${bakeryToken}`)
      .send({ is_available: false, bakeryId });

    expect(res.status).toBe(200);
    expect(res.body?.data?.isAvailable).toBe(false);

    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product.isAvailable).toBe(false);
  });

  test('rejects invalid availability value', async () => {
    const res = await request(app)
      .patch(`/api/bakery/products/${productId}/availability`)
      .set('Authorization', `Bearer ${bakeryToken}`)
      .send({ is_available: 'not-a-bool', bakeryId });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/true or false/i);
  });

  test('returns 404 when product not found', async () => {
    const res = await request(app)
      .patch('/api/bakery/products/missing-product/availability')
      .set('Authorization', `Bearer ${bakeryToken}`)
      .send({ is_available: true, bakeryId });

    expect(res.status).toBe(404);
  });

  test('blocks bakery owner from toggling products they do not own', async () => {
    const restaurantProductId = 'test-restaurant-product-id';
    const res = await request(app)
      .patch(`/api/bakery/products/${restaurantProductId}/availability`)
      .set('Authorization', `Bearer ${bakeryToken}`)
      .send({ is_available: true, bakeryId });

    expect(res.status).toBe(403);
  });
});
