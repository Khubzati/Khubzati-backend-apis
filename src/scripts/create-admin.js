/**
 * Script to create an admin user
 * Usage: node src/scripts/create-admin.js
 * 
 * Or with custom credentials:
 * ADMIN_EMAIL=admin@khubzati.com ADMIN_PASSWORD=yourpassword node src/scripts/create-admin.js
 */

require('dotenv').config();
const { PrismaClient } = require('../generated/prisma');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createAdminUser() {
    try {
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@khubzati.com';
        const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@1234';
        const adminUsername = process.env.ADMIN_USERNAME || 'admin';
        const adminFullName = process.env.ADMIN_FULL_NAME || 'Administrator';

        console.log('Creating admin user...');
        console.log(`Email: ${adminEmail}`);
        console.log(`Username: ${adminUsername}`);

        // Check if admin user already exists
        const existingAdmin = await prisma.user.findFirst({
            where: {
                OR: [
                    { email: adminEmail },
                    { username: adminUsername },
                    { role: 'admin' }
                ]
            }
        });

        if (existingAdmin) {
            console.log('Admin user already exists!');
            console.log(`Email: ${existingAdmin.email}`);
            console.log(`Role: ${existingAdmin.role}`);

            if (existingAdmin.role !== 'admin') {
                console.log('Updating existing user to admin role...');
                await prisma.user.update({
                    where: { id: existingAdmin.id },
                    data: { role: 'admin' }
                });
                console.log('User role updated to admin!');
            }

            await prisma.$disconnect();
            return;
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(adminPassword, salt);

        // Create admin user
        const adminUser = await prisma.user.create({
            data: {
                username: adminUsername,
                email: adminEmail,
                password: hashedPassword,
                fullName: adminFullName,
                phoneNumber: '+966500000000', // Default phone number
                role: 'admin',
                isVerified: true
            }
        });

        console.log('✅ Admin user created successfully!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Admin Credentials:');
        console.log(`  Email: ${adminEmail}`);
        console.log(`  Password: ${adminPassword}`);
        console.log(`  Username: ${adminUsername}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('\n⚠️  IMPORTANT: Please change the default password after first login!');

        await prisma.$disconnect();
    } catch (error) {
        console.error('❌ Error creating admin user:', error);
        await prisma.$disconnect();
        process.exit(1);
    }
}

createAdminUser();

