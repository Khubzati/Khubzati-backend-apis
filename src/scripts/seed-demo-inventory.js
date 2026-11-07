/**
 * Add one demo inventory product for every active bread type in the catalog.
 *
 * Requires BAKERY_ID or BAKERY_OWNER_ID so demo stock can never be inserted
 * into an arbitrary bakery. Existing matching products are left untouched,
 * making reruns safe. Bread types are read from the target database's active
 * catalog so newly imported types are included.
 *
 * Usage:
 *   BAKERY_ID=<bakery-id> npm run seed:demo-inventory
 *   BAKERY_OWNER_ID=<user-id> npm run seed:demo-inventory
 */

require('dotenv').config();
const prisma = require('../lib/prisma');

const DEFAULT_UNIT = 'piece';
const CURRENCY = 'JOD';

const normalize = (value) => String(value || '').trim().toLowerCase();

const demoValues = (index) => ({
    price: (0.15 + ((index * 13) % 166) / 100).toFixed(2),
    stockQuantity: 25 + ((index * 17) % 76),
    calories: 120 + ((index * 37) % 241),
});

async function seedDemoInventory() {
    const bakeryId = process.env.BAKERY_ID?.trim();
    const bakeryOwnerId = process.env.BAKERY_OWNER_ID?.trim();
    if (!bakeryId && !bakeryOwnerId) {
        throw new Error('Set BAKERY_ID or BAKERY_OWNER_ID to identify the bakery that should receive demo products.');
    }

    let bakery;
    if (bakeryId) {
        bakery = await prisma.bakery.findFirst({
            where: { id: bakeryId, deletedAt: null },
            select: { id: true, ownerId: true },
        });
    } else {
        const ownedBakeries = await prisma.bakery.findMany({
            where: { ownerId: bakeryOwnerId, deletedAt: null },
            select: { id: true, ownerId: true },
        });
        if (ownedBakeries.length > 1) {
            throw new Error(`Owner has ${ownedBakeries.length} bakeries. Set BAKERY_ID to choose one.`);
        }
        bakery = ownedBakeries[0];
    }
    if (!bakery) {
        throw new Error(bakeryId
            ? `Bakery not found: ${bakeryId}`
            : `No bakery found for owner: ${bakeryOwnerId}`);
    }

    const breadTypes = await prisma.breadTypeCatalog.findMany({
        where: { isActive: true, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { englishName: 'asc' }],
        select: { key: true, englishName: true, arabicName: true, imageUrl: true, tags: true },
    });
    if (breadTypes.length === 0) {
        throw new Error('The active bread type catalog is empty in the configured database.');
    }
    const existingProducts = await prisma.product.findMany({
        where: { bakeryId, deletedAt: null },
        select: { name: true, description: true, dietaryInfo: true },
    });
    const existingNames = new Set();
    for (const product of existingProducts) {
        existingNames.add(normalize(product.name));
        existingNames.add(normalize(product.description));
        if (product.dietaryInfo && typeof product.dietaryInfo === 'object') {
            existingNames.add(normalize(product.dietaryInfo.type));
            existingNames.add(normalize(product.dietaryInfo.typeKey));
        }
    }

    let added = 0;
    let skipped = 0;
    for (const [index, breadType] of breadTypes.entries()) {
        const nameKey = normalize(breadType.englishName);
        const typeKey = normalize(breadType.key);
        if (existingNames.has(nameKey) || existingNames.has(typeKey)) {
            skipped += 1;
            continue;
        }

        const values = demoValues(index);
        await prisma.product.create({
            data: {
                name: breadType.englishName,
                description: breadType.englishName,
                price: values.price,
                currency: CURRENCY,
                imageUrl: breadType.imageUrl || null,
                itemType: 'bakery',
                bakeryId: bakery.id,
                stockQuantity: values.stockQuantity,
                isAvailable: true,
                dietaryInfo: {
                    type: breadType.englishName,
                    typeKey: breadType.key,
                    unit: DEFAULT_UNIT,
                    calories: values.calories,
                    tags: breadType.tags || [],
                },
                createdBy: bakery.ownerId,
            },
        });
        existingNames.add(nameKey);
        existingNames.add(typeKey);
        added += 1;
    }

    console.log(`Demo inventory complete. Added: ${added}; already present: ${skipped}; catalog types: ${breadTypes.length}.`);
}

seedDemoInventory()
    .catch((error) => {
        console.error('Failed to seed demo inventory:', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
