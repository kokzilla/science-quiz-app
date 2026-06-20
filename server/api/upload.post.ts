import { defineEventHandler, readMultipartFormData, createError } from 'h3'
import fs from 'fs'
import path from 'path'

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  if (!parts || parts.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No files uploaded',
    })
  }

  // Find the file part
  const filePart = parts.find((part) => part.name === 'file')
  if (!filePart || !filePart.filename) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No file part found',
    })
  }

  const filename = filePart.filename
  // Clean filename to prevent path traversal
  const safeFilename = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  
  // Define destination path (public/questions/)
  const destDir = path.resolve(process.cwd(), 'public/questions')
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true })
  }

  const destPath = path.join(destDir, safeFilename)
  
  // Write the file
  fs.writeFileSync(destPath, filePart.data)

  // Return the web path
  return {
    success: true,
    url: `/questions/${safeFilename}`,
  }
})
