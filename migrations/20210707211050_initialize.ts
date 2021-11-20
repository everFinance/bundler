import { Knex } from "knex";
import { config } from "dotenv";

config();

export async function up(knex: Knex): Promise<void> {
  const schema = await knex.schema
    .withSchema("public")
    .createTable("balance_transactions", (table) => {
      table.string("tx_id").primary().unique();
      table.string("address");
      table.enum("currency", ["arweave", "solana", "matic"]).notNullable()
      //table.bigInteger("amount");
      table.decimal("amount", 30, 0);
      table.bigInteger("block_height");
      table.boolean("confirmed").notNullable()
      table.timestamp("date_created", { useTz: true }).defaultTo(knex.fn.now());
      table.index(["address", "currency"])
    })
    .createTable("bundles", (table) => {
      table.bigIncrements("bundle_id", { primaryKey: true });
      table.string("tx_id", 100)
        .nullable()
        .unique();
      table.boolean("is_seeded").defaultTo(false).notNullable();
      table.bigInteger("job_id").nullable();
      table.integer("requeued").notNullable().defaultTo(0);
      table.boolean("cleared").defaultTo(false).notNullable();
      table.timestamp("date_created", { useTz: true }).defaultTo(knex.fn.now());
    })
    .createTable("data_items", (table) => {
      table.string("data_item_id").primary();
      table.string("address").notNullable().index();
      table.bigInteger("bundle_id")
        .nullable()
        .index()
        .references("bundle_id")
        .inTable("bundles");
      table.bigInteger("size").notNullable();
      table.enum("currency", ["arweave", "solana", "matic"]).notNullable()
      //table.bigInteger("fee").notNullable();
      table.decimal("fee", 30, 0).notNullable();
      table.string("fee_transaction").nullable()
      table.binary("signature").unique().notNullable()
      table.bigInteger("current_block").notNullable()
      table.bigInteger("expected_block").notNullable()
      table.jsonb("gateways").defaultTo([]).notNullable()
      table.timestamp("date_created", { useTz: true }).defaultTo(knex.fn.now());
    })
    .createTable("peers", (table) => {
      table.string("peer").primary()
      table.specificType("trust", "double precision").defaultTo(0);
      table.timestamp("date_created", { useTz: true }).defaultTo(knex.fn.now());
    })
    .createTable("bundler_peers", (table) => {
      table.string("address").primary();
      table.string("public_key").notNullable();
      table.string("initializer_tx").unique().notNullable();
      table.string("host").unique().notNullable();
      table.integer("port").notNullable();
    })
    .createTable("fee_sums", (table) => {
      table.string("address").notNullable();
      table.string("currency", 20).notNullable();
      table.decimal("sum_of_fees", 30, 0).notNullable();
      table.primary(["address", "currency"]);
    });

  await knex.raw(`
  CREATE OR REPLACE FUNCTION func_sum_fees()
    RETURNS TRIGGER AS
    $$
    begin
        INSERT into fee_sums (address, currency, sum_of_fees)
        VALUES (NEW.address, NEW.currency, NEW.fee)
        ON CONFLICT (address, currency)
        DO UPDATE SET sum_of_fees = fee_sums.sum_of_fees + excluded.sum_of_fees;
        RETURN NEW;
    end;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER fee_sums
        AFTER INSERT ON data_items
        FOR EACH ROW
    EXECUTE PROCEDURE func_sum_fees();
  `);

  await knex.raw(`
  CREATE OR REPLACE FUNCTION balance(arweaveAddress varchar(255), curr varchar(20))
    RETURNS BIGINT
    LANGUAGE plpgsql
    AS
    $$
    declare
        received bigint;
        used bigint;
    begin
        select coalesce(sum(amount), 0)
        into received
        from balance_transactions
        where address = arweaveAddress
        and currency = curr
        and ((amount > 0 and confirmed = true) or amount < 0);

        select sum_of_fees
        into used
        from fee_sums
        where address = arweaveAddress
        and currency = curr;

        return received - coalesce(used, 0);
    end;
    $$;
  `);

  await knex.raw(`
  create or replace procedure create_new_batch()
      language plpgsql
  as
  $$
  declare
      new_bundle_id  bigint;
      cumulative_sum bigint = 0;
      t_row          data_items%rowtype;
      last           varchar(255);
  begin
      DROP TABLE IF EXISTS test;
      CREATE TEMP TABLE test
      (
          id   varchar(255),
          date timestamp not null default now()::timestamp
      );

      FOR t_row IN
          SELECT *
          FROM data_items
          WHERE bundle_id IS NULL
          ORDER BY date_created
          LOOP
              INSERT INTO test VALUES (t_row.data_item_id);
              EXIT WHEN (cumulative_sum + t_row.size) > 750000000;
              cumulative_sum = cumulative_sum + t_row.size;
          END LOOP;

      IF cumulative_sum > 750000000 THEN
          DELETE FROM test t1
          USING (SELECT id, MAX(date) FROM test GROUP BY id) t2
          WHERE t1.id = t2.id;
      END IF;

      IF (SELECT COUNT(*) FROM test) = 0::bigint THEN RETURN; end if;

      INSERT INTO bundles (tx_id)
      VALUES (NULL)
      RETURNING bundle_id INTO new_bundle_id;

      UPDATE data_items
      SET bundle_id = new_bundle_id
      WHERE data_item_id IN (SELECT id FROM test);
  end;
  $$;
  `);

  return schema;
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw("DROP VIEW IF EXISTS balances");
  await knex.raw("DROP PROCEDURE IF EXISTS create_new_batch");
  await knex.schema
    .withSchema("public")
    .dropTableIfExists("external_balances")
    .dropTableIfExists("external_data_items")
    .dropTableIfExists("bundler_peers")
    .dropTableIfExists("data_items")
    .dropTableIfExists("balance_transactions")
    .dropTableIfExists("bundles")
    .dropTableIfExists("peers")
    .dropTableIfExists("temp_peers")
    .dropTableIfExists("gateways")
    .dropTableIfExists("fee_sums");
}

