import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: Request) {
    try {
        const { username, email, phoneNumber, fullName } = await request.json();

        // Validate required fields (no password required)
        if (!username || !email || !phoneNumber) {
            return NextResponse.json(
                { status: 'error', message: 'Missing required fields: username, email, and phoneNumber are required' },
                { status: 400 }
            );
        }

        // Check if user already exists
        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [
                    { email },
                    { phoneNumber },
                    { username }
                ]
            }
        });

        if (existingUser) {
            return NextResponse.json(
                { status: 'error', message: 'User already exists with this email, phone number, or username' },
                { status: 400 }
            );
        }

        // Create user without password
        const user = await prisma.user.create({
            data: {
                username,
                email,
                phoneNumber,
                password: '', // Empty password since we don't use passwords
                fullName,
                role: 'customer'
            }
        });

        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );

        // Remove password from user data
        const userData = { ...user } as any;
        delete userData.password;

        return NextResponse.json({
            status: 'success',
            message: 'User registered successfully',
            data: {
                user: userData,
                token
            }
        });

    } catch (error: any) {
        console.error('Registration error:', error);
        return NextResponse.json(
            {
                status: 'error',
                message: error.message || 'An error occurred during registration',
                details: error
            },
            { status: 500 }
        );
    }
} 