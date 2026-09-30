import type { NextConfig } from 'next';

/* 这个文件是空的，但不是多余的 —— vinext 会主动查找并读取 next.config.*
   （dist 里有 10 处引用），删掉它可能导致配置探测失败。
   真正的构建配置在 vite.config.ts：vinext 以 Vite 插件的形式接入，
   __WPANEL_API__ 的注入和 dev server 的文件监听策略都在那里。
   两处不是「两套构建配置」，而是 vinext 的 Next 兼容层 + Vite 的实际配置。 */
const nextConfig: NextConfig = {};

export default nextConfig;
