import { PrismaMariaDb } from "@prisma/adapter-mariadb"
import { mariaDbOptions, cachedClient } from "@kaperkunde/next-kit/prisma"

import { PrismaClient } from "./generated/prisma/client"

export const db = cachedClient(
  "badcamPrisma",
  () =>
    new PrismaClient({
      adapter: new PrismaMariaDb(
        mariaDbOptions({ urlVariable: "DATABASE_URL" }),
      ),
    }),
)

export type Db = typeof db
