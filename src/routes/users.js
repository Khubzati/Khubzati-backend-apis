const express = require('express');
const { PrismaClient } = require('../generated/prisma');
const { authenticateToken } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = express.Router();

// Get current user profile
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        phoneNumber: true,
        role: true,
        isVerified: true,
        profilePictureUrl: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!user) {
      return res.status(404).json({
        status: 'fail',
        message: 'User not found'
      });
    }

    return res.status(200).json({
      status: 'success',
      data: {
        user
      }
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching user profile'
    });
  }
});

// Update current user profile
router.put('/me', authenticateToken, async (req, res) => {
  try {
    const { fullName, phoneNumber, profilePictureUrl } = req.body;
    
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(fullName !== undefined && { fullName }),
        ...(phoneNumber !== undefined && { phoneNumber }),
        ...(profilePictureUrl !== undefined && { profilePictureUrl }),
        updatedBy: req.user.id,
        updatedAt: new Date()
      },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        phoneNumber: true,
        role: true,
        isVerified: true,
        profilePictureUrl: true,
        createdAt: true,
        updatedAt: true
      }
    });
    
    return res.status(200).json({
      status: 'success',
      data: {
        user
      }
    });
  } catch (error) {
    console.error('Update user profile error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while updating user profile'
    });
  }
});

// Get all addresses for current user
router.get('/me/addresses', authenticateToken, async (req, res) => {
  try {
    const addresses = await prisma.address.findMany({
      where: { userId: req.user.id, deletedAt: null }
    });
    
    return res.status(200).json({
      status: 'success',
      data: {
        addresses
      }
    });
  } catch (error) {
    console.error('Get addresses error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching addresses'
    });
  }
});

// Add a new address for current user
router.post('/me/addresses', authenticateToken, async (req, res) => {
  try {
    const {
      addressLine1,
      addressLine2,
      city,
      postalCode,
      country,
      addressType,
      isDefault,
      latitude,
      longitude
    } = req.body;
    
    // Create new address
    const address = await prisma.address.create({
      data: {
        userId: req.user.id,
        addressLine1,
        addressLine2,
        city,
        postalCode,
        country: country || 'Saudi Arabia',
        addressType: addressType || 'home',
        isDefault: isDefault || false,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        createdBy: req.user.id
      }
    });
    
    // If this address is set as default, update other addresses
    if (address.isDefault) {
      await prisma.address.updateMany({
        where: {
          userId: req.user.id,
          id: { not: address.id },
          isDefault: true
        },
        data: {
          isDefault: false,
          updatedBy: req.user.id,
          updatedAt: new Date()
        }
      });
    }
    
    return res.status(201).json({
      status: 'success',
      data: {
        address
      }
    });
  } catch (error) {
    console.error('Add address error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while adding address'
    });
  }
});

// Update an existing address
router.put('/me/addresses/:addressId', authenticateToken, async (req, res) => {
  try {
    const { addressId } = req.params;
    const {
      addressLine1,
      addressLine2,
      city,
      postalCode,
      country,
      addressType,
      isDefault,
      latitude,
      longitude
    } = req.body;
    
    // Find address and ensure it belongs to the current user
    const existingAddress = await prisma.address.findFirst({
      where: {
        id: addressId,
        userId: req.user.id,
        deletedAt: null
      }
    });
    
    if (!existingAddress) {
      return res.status(404).json({
        status: 'fail',
        message: 'Address not found or does not belong to you'
      });
    }
    
    // Update address
    const address = await prisma.address.update({
      where: { id: addressId },
      data: {
        ...(addressLine1 !== undefined && { addressLine1 }),
        ...(addressLine2 !== undefined && { addressLine2 }),
        ...(city !== undefined && { city }),
        ...(postalCode !== undefined && { postalCode }),
        ...(country !== undefined && { country }),
        ...(addressType !== undefined && { addressType }),
        ...(latitude !== undefined && { latitude: parseFloat(latitude) }),
        ...(longitude !== undefined && { longitude: parseFloat(longitude) }),
        ...(isDefault !== undefined && { isDefault }),
        updatedBy: req.user.id,
        updatedAt: new Date()
      }
    });
    
    // If setting as default, update other addresses
    if (isDefault && !existingAddress.isDefault) {
      await prisma.address.updateMany({
        where: {
          userId: req.user.id,
          id: { not: addressId },
          isDefault: true
        },
        data: {
          isDefault: false,
          updatedBy: req.user.id,
          updatedAt: new Date()
        }
      });
    }
    
    return res.status(200).json({
      status: 'success',
      data: {
        address
      }
    });
  } catch (error) {
    console.error('Update address error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while updating address'
    });
  }
});

// Delete an address
router.delete('/me/addresses/:addressId', authenticateToken, async (req, res) => {
  try {
    const { addressId } = req.params;
    
    // Find address and ensure it belongs to the current user
    const address = await prisma.address.findFirst({
      where: {
        id: addressId,
        userId: req.user.id,
        deletedAt: null
      }
    });
    
    if (!address) {
      return res.status(404).json({
        status: 'fail',
        message: 'Address not found or does not belong to you'
      });
    }
    
    // Soft delete the address
    await prisma.address.update({
      where: { id: addressId },
      data: {
        deletedAt: new Date(),
        updatedBy: req.user.id,
        updatedAt: new Date()
      }
    });
    
    return res.status(200).json({
      status: 'success',
      message: 'Address deleted successfully'
    });
  } catch (error) {
    console.error('Delete address error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while deleting address'
    });
  }
});

module.exports = router;
