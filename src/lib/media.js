import { supabase } from './supabase'

// Pictures for the public home page (the owner's photo, event posters). Shrunk on the phone to at most
// `max` px and saved as JPEG in the public "shop-media" bucket under the shop's id (only the admin may write).
export async function uploadShopImage(householdId, file, name, max = 1600, background = null) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  // Product photos often have a transparent background, which turns black as JPEG — paint it first.
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height) }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85))
  const path = `${householdId}/${name}-${Date.now()}.jpg`
  const { error } = await supabase.storage.from('shop-media').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
  if (error) throw error
  return supabase.storage.from('shop-media').getPublicUrl(path).data.publicUrl
}
