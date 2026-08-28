#!/usr/bin/env node

// 全局安装入口：注册 tsx 加载器以支持 .tsx（JSX）入口
import { register } from "tsx/esm/api";
register();
await import("./index.ts");