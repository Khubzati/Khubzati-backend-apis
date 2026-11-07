/**
 * Seed the bread type catalog from a JSON file.
 *
 * Idempotent: upserts each entry by `key`, so it is safe to run on a fresh DB
 * or to re-run after the source JSON changes. Mirrors the normalization used by
 * the admin import endpoint (POST /api/admin/bread-types/import).
 *
 * Usage:
 *   node src/scripts/seed-bread-types.js
 *
 * Point at a different source file:
 *   BREAD_TYPES_FILE=/path/to/bread_types.json node src/scripts/seed-bread-types.js
 *
 * Stamp an actor into created_by/updated_by (defaults to null):
 *   SEED_ACTOR=seed-script node src/scripts/seed-bread-types.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');

// Default to the canonical data file bundled with the repo, resolved relative to
// this script so the current working directory does not matter.
const DEFAULT_FILE = path.resolve(__dirname, '../data/bread-types.json');

// Matches toSlugKey() in src/routes/admin.js.
const toSlugKey = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';

    return normalized
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, '_')
        .replace(/^_+|_+$/g, '');
};

// Matches parseBoolean() in src/routes/admin.js.
const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
    return fallback;
};

const trimOrNull = (value) =>
    typeof value === 'string' ? value.trim() || null : null;

async function seedBreadTypes() {
    const filePath = process.env.BREAD_TYPES_FILE
        ? path.resolve(process.env.BREAD_TYPES_FILE)
        : DEFAULT_FILE;
    const actor = process.env.SEED_ACTOR || null;

    if (!fs.existsSync(filePath)) {
        console.error(`❌ Bread types file not found: ${filePath}`);
        process.exit(1);
    }

    let list;
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        // Accept either a bare array or { breadTypes: [...] } (import payload shape).
        list = Array.isArray(parsed) ? parsed : parsed?.breadTypes;
    } catch (error) {
        console.error(`❌ Failed to read/parse ${filePath}:`, error.message);
        process.exit(1);
    }

    if (!Array.isArray(list) || list.length === 0) {
        console.error('❌ No bread types found in file (expected an array or { breadTypes: [...] }).');
        process.exit(1);
    }

    console.log(`Seeding bread types from ${filePath} (${list.length} entries)...`);

    let imported = 0;
    let skipped = 0;

    for (const rawItem of list) {
        if (!rawItem || typeof rawItem !== 'object') {
            skipped += 1;
            continue;
        }

        const key = toSlugKey(rawItem.key || rawItem.englishName);
        const englishName = String(rawItem.englishName || '').trim();

        if (!key || !englishName) {
            skipped += 1;
            continue;
        }

        const fields = {
            englishName,
            arabicName: trimOrNull(rawItem.arabicName),
            imageUrl: trimOrNull(rawItem.imageUrl),
            imageSource: trimOrNull(rawItem.imageSource),
            imageCredit: trimOrNull(rawItem.imageCredit),
            description: trimOrNull(rawItem.description),
            tags: Array.isArray(rawItem.tags) ? rawItem.tags : null,
            sortOrder: Number.isFinite(Number(rawItem.sortOrder)) ? Number(rawItem.sortOrder) : 0,
            isActive: parseBoolean(rawItem.isActive, true),
        };

        await prisma.breadTypeCatalog.upsert({
            where: { key },
            create: {
                key,
                ...fields,
                createdBy: actor,
                updatedBy: actor,
            },
            update: {
                ...fields,
                updatedBy: actor,
                updatedAt: new Date(),
                deletedAt: null,
            },
        });

        imported += 1;
    }

    console.log(`✅ Bread type catalog seeded. Imported/updated: ${imported}, skipped: ${skipped}.`);
}

seedBreadTypes()
    .catch((error) => {
        console.error('❌ Error seeding bread types:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
