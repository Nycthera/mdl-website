import { createClient } from '@/lib/supabase/server'

export async function readDatabaseRows<RowType = Record<string, unknown>>(
	tableName: string,
	columns = '*'
): Promise<RowType[]> {
	const supabase = await createClient()
	const { data, error } = await supabase.from(tableName).select(columns)

	if (error) {
		throw error
	}

	return (data ?? []) as RowType[]
}
