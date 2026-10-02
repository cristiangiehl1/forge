import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { importSql } from '../../../sql/parse/import-sql.ts'

let counter = 0
const run = (sql: string) => importSql(sql, () => `id-${++counter}`)

/** The shape of a script produced by `pg_dump --schema-only`, with a data block. */
const DUMP = `--
-- PostgreSQL database dump
--

\\restrict abc123

SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SELECT pg_catalog.set_config('search_path', '', false);

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';

CREATE TYPE public.order_status AS ENUM (
    'pending',
    'paid',
    'it''s shipped'
);

CREATE DOMAIN public.email AS character varying(255)
    CONSTRAINT email_check CHECK (((VALUE)::text ~~ '%@%'::text));

CREATE FUNCTION public.touch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.users (
    id integer NOT NULL,
    name character varying(120) NOT NULL,
    email public.email NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    bio text
);

COMMENT ON TABLE public.users IS 'People who can order';
COMMENT ON COLUMN public.users.email IS 'Login address; unique';

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

CREATE TABLE public.orders (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    status public.order_status DEFAULT 'pending'::public.order_status NOT NULL,
    total numeric(12,2),
    note character varying,
    tags text[] DEFAULT '{}'::text[],
    CONSTRAINT orders_total_check CHECK ((total >= (0)::numeric))
);

CREATE TABLE public.order_items (
    order_id bigint NOT NULL,
    line integer NOT NULL,
    qty integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

COPY public.users (id, name, email, created_at, bio) FROM stdin;
1	Ana; the first	ana@example.com	2024-01-01 00:00:00+00	\\N
2	Bob	bob@example.com	2024-01-02 00:00:00+00	has; semicolons; and 'quotes'
\\.

INSERT INTO public.order_items VALUES (1, 1, 1);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (order_id, line);

CREATE INDEX idx_orders_user ON public.orders USING btree (user_id);
CREATE INDEX idx_orders_status_paid ON public.orders USING btree (status) WHERE (status = 'paid'::public.order_status);
CREATE INDEX idx_users_lower_name ON public.users USING btree (lower((name)::text));

CREATE TRIGGER users_touch BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.touch();

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);

--
-- PostgreSQL database dump complete
--
`

describe('importSql: a pg_dump script', () => {
  const result = run(DUMP)
  const table = (name: string) =>
    result.schema.tables.find((t) => t.name === name)

  it('has no errors', () => {
    assert.deepEqual(result.errors, [])
  })

  it('imports the tables, in order, and nothing from the data block', () => {
    assert.deepEqual(
      result.schema.tables.map((t) => t.name),
      ['users', 'orders', 'order_items']
    )
  })

  it('imports the types and what uses them', () => {
    assert.deepEqual(
      result.schema.types?.map((t) => [t.kind, t.name]),
      [
        ['enum', 'order_status'],
        ['domain', 'email'],
      ]
    )
    const status = table('orders')?.columns.find((c) => c.name === 'status')
    assert.equal(status?.type.kind, 'user')
    assert.equal(status?.default, "'pending'::public.order_status")
    const enumType = result.schema.types?.[0]
    assert.deepEqual(enumType?.kind === 'enum' && enumType.values, [
      'pending',
      'paid',
      "it's shipped",
    ])
  })

  it('reads the sequence default set by ALTER COLUMN as an identity, and now() as generated', () => {
    const users = table('users')
    assert.equal(users?.columns.find((c) => c.name === 'id')?.generated, true)
    assert.equal(
      users?.columns.find((c) => c.name === 'created_at')?.generated,
      true
    )
    assert.deepEqual(users?.primaryKey, [users?.columns[0]?.id])
  })

  it('reads composite primary keys, uniques, indexes and comments', () => {
    assert.equal(table('order_items')?.primaryKey.length, 2)
    assert.deepEqual(
      table('users')?.indexes?.map((i) => [i.name, i.unique]),
      [['users_email_key', true]]
    )
    assert.deepEqual(
      table('orders')?.indexes?.map((i) => i.name),
      ['idx_orders_user']
    )
    assert.equal(table('users')?.comment, 'People who can order')
    assert.equal(
      table('users')?.columns.find((c) => c.name === 'email')?.comment,
      'Login address; unique'
    )
  })

  it('keeps both foreign keys, and warns about the cascade', () => {
    assert.equal(result.schema.relationships.length, 2)
    assert.ok(result.warnings.some((w) => w.message.includes('ON DELETE')))
  })

  it('warns, with lines, about everything Forge does not model', () => {
    const text = result.warnings.map((w) => w.message).join('\n')
    for (const fragment of [
      'SET',
      'SELECT',
      'CREATE EXTENSION',
      'COMMENT ON EXTENSION',
      'CREATE FUNCTION',
      'CREATE SEQUENCE',
      'ALTER SEQUENCE',
      'INSERT INTO',
      'CREATE TRIGGER',
      'CHECK',
      'idx_orders_status_paid',
      'idx_users_lower_name',
    ]) {
      assert.ok(text.includes(fragment), `no warning mentions ${fragment}`)
    }
    assert.ok(result.warnings.every((w) => w.line >= 1))
  })

  it('imports every statement even when the data block holds semicolons and quotes', () => {
    assert.equal(table('order_items')?.columns.length, 3)
    // These come after the data block: they are lost if the block swallowed them.
    assert.equal(table('orders')?.primaryKey.length, 1)
    assert.equal(result.schema.relationships.length, 2)
  })
})
