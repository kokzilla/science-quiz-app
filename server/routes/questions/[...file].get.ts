import { defineEventHandler, createError } from 'h3'
import fs from 'fs'
import path from 'path'

export default defineEventHandler(async (event) => {
  // Get filename from catch-all param
  const rawParam = event.context.params?.file
  const fileName = Array.isArray(rawParam) ? rawParam.join('/') : rawParam

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
    // Explicit server hardcoded fallback path if applicable
    `C:\\Project\\science-quiz-app\\public\\questions\\${safeFileName}`,
    `C:\\Project\\science-quiz-app\\.output\\public\\questions\\${safeFileName}`
  ]

  let foundPath: string | null = null
  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      foundPath = loc
      break
    }
  }

  if (!foundPath) {
    console.error(`[Question Image Route] File not found on disk: ${safeFileName}`)
    throw createError({ statusCode: 404, statusMessage: `Image file ${safeFileName} not found on server` })
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
