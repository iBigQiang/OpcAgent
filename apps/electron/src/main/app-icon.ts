/**
 * 应用图标统一解析入口（主进程）
 *
 * 主进程内所有需要展示 OPC Agent 图标的位置（窗口、系统通知等）统一从这里取。
 * 图标文件由 resources/generate-brand-icons.sh 从单一源图生成：
 * 更换 logo 时只需替换源图并重新生成，调用方无需改动。
 */

import { existsSync } from 'fs'
import { join } from 'path'
import { nativeImage, type NativeImage } from 'electron'

/** 各平台窗口/打包图标文件名 */
function getIconFileName(): string {
  return process.platform === 'darwin' ? 'icon.icns'
    : process.platform === 'win32' ? 'icon.ico'
    : 'icon.png'
}

/** 在打包/开发两种目录布局下解析图标文件路径 */
function resolveIconPath(iconName: string): string | null {
  return [
    join(__dirname, 'resources', iconName),
    join(__dirname, '../resources', iconName),
  ].find(p => existsSync(p)) ?? null
}

/** 窗口图标路径（BrowserWindow 的 icon 选项） */
export function getAppIconPath(): string | null {
  return resolveIconPath(getIconFileName())
}

/**
 * 系统通知使用的图标图像。
 * Windows toast 的 appLogoOverride 与 Linux 通知对 .ico/.icns 支持不佳，
 * 统一优先使用 PNG，保证通知里能显示 logo。
 */
export function getAppNotificationIcon(): NativeImage | null {
  const pngPath = resolveIconPath('icon.png')
  if (pngPath) return nativeImage.createFromPath(pngPath)
  const fallbackPath = getAppIconPath()
  return fallbackPath ? nativeImage.createFromPath(fallbackPath) : null
}
