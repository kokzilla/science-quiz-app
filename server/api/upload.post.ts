import { defineEventHandler, readMultipartFormData, createError } from 'h3'
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  if (!parts || parts.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No data uploaded',
    })
  }

  // 1. Validate passkey
  const passkeyPart = parts.find((part) => part.name === 'passkey')
  if (!passkeyPart) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Authentication required: passkey missing',
    })
  }

  const passkey = passkeyPart.data.toString('utf-8').trim()
  const config = useRuntimeConfig(event)
  const supabaseUrl = process.env.SUPABASE_URL || (config.public?.supabaseUrl as string) || ''
  const supabaseKey = process.env.SUPABASE_KEY || (config.public?.supabaseKey as string) || ''

  if (!supabaseUrl || !supabaseKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Supabase URL or Key not configured on the server',
    })
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    })
    
    // Validate passkey using validate_passkey RPC
    const { data: isValid, error: rpcError } = await supabase.rpc('validate_passkey', {
      p_role: 'admin',
      p_passkey: passkey
    })

    if (rpcError || !isValid) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden: Invalid admin passkey',
      })
    }
  } catch (err: any) {
    if (err.statusCode) throw err
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to authenticate: ${err.message || err}`,
    })
  }

  // 2. Find and validate the file part
  const filePart = parts.find((part) => part.name === 'file')
  if (!filePart || !filePart.filename) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No file part found',
    })
  }

  const filename = filePart.filename
  const fileType = filePart.type || ''
  const fileSize = filePart.data.length

  // Check file size (limit: 5MB)
  const MAX_SIZE = 5 * 1024 * 1024
  if (fileSize > MAX_SIZE) {
    throw createError({
      statusCode: 400,
      statusMessage: 'File size exceeds 5MB limit',
    })
  }

  // Check MIME type
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
  if (!allowedMimeTypes.includes(fileType.toLowerCase())) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid file type. Only JPG, PNG, GIF, and WEBP images are allowed.',
    })
  }

  // Clean filename to prevent path traversal
  const ext = path.extname(filename).toLowerCase()
  const base = path.basename(filename, ext).replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const safeFilename = `${base}_${Date.now()}${ext}`

  // Verify extension matches allowed image extensions
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
  if (!allowedExtensions.includes(ext)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid file extension.',
    })
  }
  
  // Save file to all potential target directories to ensure availability
  const targetDirs = [
    path.resolve(process.cwd(), 'public/questions'),
    path.resolve(process.cwd(), '.output/public/questions'),
    path.resolve(process.cwd(), '../public/questions'),
    path.resolve(process.cwd(), '../../public/questions'),
    'C:\\Project\\science-quiz-app\\public\\questions',
    'C:\\Project\\science-quiz-app\\.output\\public\\questions'
  ]

  for (const dir of targetDirs) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(path.join(dir, safeFilename), filePart.data)
    } catch (e) {
      // Ignore errors for non-existent root paths
    }
  }

  // Return the web path
  return {
    success: true,
    url: `/questions/${safeFilename}`,
  }
})
