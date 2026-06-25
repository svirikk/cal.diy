// src/prisma.ts
// Singleton Prisma Client — підключається до тієї ж БД що і Cal.diy

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default prisma;
