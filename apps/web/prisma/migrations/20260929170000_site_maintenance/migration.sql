CREATE TABLE "site_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "maintenance_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "site_settings_singleton" CHECK ("id" = 1)
);

INSERT INTO "site_settings" ("id", "maintenance_enabled") VALUES (1, false);
