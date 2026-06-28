import { createServiceClient } from '@/lib/supabase/server'
import AdmZip from 'adm-zip'

export type MitRegistryRecord = {
  cert_number: string
  company_name: string | null
  brand_name: string | null
  product_name: string | null
  product_model: string | null
  industry_type: string | null
  valid_until: string | null
}

export function parseMitCsv(csvContent: string): MitRegistryRecord[] {
  if (!csvContent.trim()) return []

  const lines = csvContent.split('\n').filter((line) => line.trim())
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map((h) => h.trim())
  const records: MitRegistryRecord[] = []

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((c) => c.trim())
    const row: Record<string, string> = {}

    headers.forEach((header, idx) => {
      row[header] = cells[idx] ?? ''
    })

    const certNumber = row['標章編號'] ?? ''
    if (!certNumber) continue

    records.push({
      cert_number: certNumber,
      company_name: row['獲證業者'] || null,
      brand_name: row['品牌名稱'] || null,
      product_name: row['產品名稱'] || null,
      product_model: row['產品型號'] || null,
      industry_type: row['產業別'] || null,
      valid_until: row['產品效期'] || null,
    })
  }

  return records
}

export async function lookupCertNumber(certNumber: string): Promise<MitRegistryRecord | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('mit_registry')
    .select('*')
    .eq('cert_number', certNumber)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }

  return data as MitRegistryRecord
}

const MIT_ZIP_URL = 'https://keid.nat.gov.tw/mittw/Files/Download/productlist.zip'
const CSV_FILENAME = '011.csv'
const BATCH_SIZE = 500

export async function syncMitRegistry(): Promise<{ recordCount: number; durationMs: number }> {
  const startMs = Date.now()

  const response = await fetch(MIT_ZIP_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch MIT registry ZIP: ${response.status} ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const zip = new AdmZip(buffer)
  const entry = zip.getEntry(CSV_FILENAME)
  if (!entry) {
    throw new Error(`CSV file "${CSV_FILENAME}" not found in ZIP archive`)
  }

  const csvContent = entry.getData().toString('utf-8')
  const records = parseMitCsv(csvContent)

  const supabase = createServiceClient()

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from('mit_registry')
      .upsert(batch, { onConflict: 'cert_number' })

    if (error) throw error
  }

  return {
    recordCount: records.length,
    durationMs: Date.now() - startMs,
  }
}
