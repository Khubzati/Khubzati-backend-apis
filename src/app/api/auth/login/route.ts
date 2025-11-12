import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: Request) {
    try {
        const { phoneNumber } = await request.json();

        // Check if phone number is provided
        if (!phoneNumber) {
            return NextResponse.json({
                status: 'fail',
                message: 'Please provide phone number'
            }, { status: 400 });
        }

        // Find user by phone number
        const user = await prisma.user.findFirst({
            where: {
                phoneNumber: phoneNumber
            }
        });

        if (!user) {
            return NextResponse.json({
                status: 'fail',
                message: 'User not found with this phone number'
            }, { status: 404 });
        }

        // Generate JWT token (no password check needed)
        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );

        // Return user data (excluding password) and token
        const userData = { ...user } as any;
        delete userData.password;

        return NextResponse.json({
            status: 'success',
            message: 'Login successful',
            data: {
                user: userData,
                token
            }
        }, { status: 200 });

    } catch (error) {
        console.error('Login error:', error);
        return NextResponse.json({
            status: 'error',
            message: 'An error occurred during login'
        }, { status: 500 });
    }
} 