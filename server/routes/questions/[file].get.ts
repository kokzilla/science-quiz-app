import { defineEventHandler, createError } from 'h3'
import fs from 'fs'
import path from 'path'

export default defineEventHandler(async (event) => {
  const fileName = event.context.params?.file
  if (!fileName) {
    throw createError({ statusCode: 404, statusMessage: 'File name not specified' })
  }

  // Sanitize filename to prevent path traversal
  const safeFileName = path.basename(fileName)
  
  // Search in potential server directories
  const locations = [
    path.resolve(process.cwd(), 'public/questions', safeFileName),
    path.resolve(process.cwd(), '.output/public/questions', safeFileName),
    path.resolve(process.cwd(), '../public/questions', safeFileName),
    path.resolve(process.cwd(), '../../public/questions', safeFileName),
  ]

  let foundPath: string | null = null
  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      foundPath = loc
      break
    }
  }

  if (!foundPath) {
    throw createError({ statusCode: 404, statusMessage: 'Image file not found on server' })
  }

  // Map MIME types
  const ext = path.extname(safeFileName).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml'
  }

  const contentType = mimeMap[ext] || 'application/octet-stream'
  
  event.node.res.setHeader('Content-Type', contentType)
  event.node.res.setHeader('Cache-Control', 'public, max-age=86400')

  return fs.createReadStream(foundPath)
})
