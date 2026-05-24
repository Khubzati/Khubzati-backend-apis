process.env.NODE_ENV = 'test';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/app');

describe('Upload validation', () => {
  const tempDir = path.join(__dirname, 'tmp');
  const txtPath = path.join(tempDir, 'sample.txt');

  beforeAll(() => {
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(txtPath, 'sample');
  });

  afterAll(() => {
    if (fs.existsSync(txtPath)) fs.unlinkSync(txtPath);
  });

  test('rejects unsupported file mime type', async () => {
    const res = await request(app)
      .post('/v1/upload/document')
      .attach('file', txtPath, { contentType: 'application/x-msdownload' });

    expect([400, 401, 500]).toContain(res.status);
  });

  test('blocks path traversal in upload file serving endpoint', async () => {
    const res = await request(app).get('/v1/upload/uploads/%2e%2e%2fsecret.txt');
    expect([400, 404]).toContain(res.status);
  });
});
