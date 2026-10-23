/**
 * Script to create an admin user
 * Usage: node src/scripts/create-admin.js
 * 
 * Or with custom credentials:
 * ADMIN_EMAIL=admin@khubzati.com ADMIN_PASSWORD=yourpassword node src/scripts/create-admin.js
 */

require('dotenv').config();
const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');


async function createAdminUser() {
    try {
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@khubzati.com';
        const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@1234';
        const adminUsername = process.env.ADMIN_USERNAME || 'admin';
        const adminFullName = process.env.ADMIN_FULL_NAME || 'Administrator';
        const shouldResetPassword = String(process.env.ADMIN_RESET_PASSWORD || 'false').toLowerCase() === 'true';

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

            const updateData = {};
            let hasUpdates = false;

            if (existingAdmin.role !== 'admin') {
                updateData.role = 'admin';
                hasUpdates = true;
            }

            if (existingAdmin.email !== adminEmail) {
                updateData.email = adminEmail;
                hasUpdates = true;
            }

            if (existingAdmin.username !== adminUsername) {
                updateData.username = adminUsername;
                hasUpdates = true;
            }

            if (existingAdmin.fullName !== adminFullName) {
                updateData.fullName = adminFullName;
                hasUpdates = true;
            }

            if (existingAdmin.deletedAt) {
                updateData.deletedAt = null;
                hasUpdates = true;
            }

            if (existingAdmin.isVerified !== true) {
                updateData.isVerified = true;
                hasUpdates = true;
            }

            if (shouldResetPassword) {
                console.log('ADMIN_RESET_PASSWORD=true detected, resetting admin password...');
                const salt = await bcrypt.genSalt(10);
                updateData.password = await bcrypt.hash(adminPassword, salt);
                hasUpdates = true;
            }

            if (hasUpdates) {
                await prisma.user.update({
                    where: { id: existingAdmin.id },
                    data: updateData,
                });
                console.log('✅ Existing admin user updated.');
            } else {
                console.log('No admin updates required.');
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
