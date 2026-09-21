-- Migration 006: durable managed object storage for artifact bodies.

CREATE TABLE IF NOT EXISTS hosted_objects (
  reference VARCHAR(64) NOT NULL,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  content_type VARCHAR(255) NOT NULL,
  size INTEGER NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, reference)
);

CREATE INDEX IF NOT EXISTS idx_hosted_objects_tenant_id ON hosted_objects(tenant_id);
