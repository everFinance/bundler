import { Knex } from "knex";

export async function exists(connection: (Knex), table: string, whereColumn: string, whereValue: string): Promise<boolean> {
  const res = await connection.first(
    connection.raw(
      "exists ? as present",
      connection(table).select(connection.raw("1")).where(whereColumn, "=", whereValue).limit(1)
    )
  );

  // Trust me
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  return res.present;
}
