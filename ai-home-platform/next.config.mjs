/** @type {import('next').NextConfig} */
const config = { reactStrictMode: true, distDir: process.env.BUILD_VARIANT === 'dual' ? '.next-dual' : '.next' };
export default config;
