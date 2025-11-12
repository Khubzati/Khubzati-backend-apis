/** @type {import('next').NextConfig} */
const nextConfig = {
    // Enable CORS for development
    async headers() {
        return [
            {
                // Apply these headers to all routes
                source: '/:path*',
                headers: [
                    {
                        key: 'Access-Control-Allow-Origin',
                        value: '*',
                    },
                    {
                        key: 'Access-Control-Allow-Methods',
                        value: 'GET, POST, PUT, DELETE, OPTIONS',
                    },
                    {
                        key: 'Access-Control-Allow-Headers',
                        value: 'Content-Type, Authorization',
                    },
                ],
            },
        ]
    },
    // Allow development origins
    allowedDevOrigins: [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://172.20.10.4:3000', // Add your specific IP
    ],
}

module.exports = nextConfig 