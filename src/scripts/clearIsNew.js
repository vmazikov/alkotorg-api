// scripts/clearIsNew.js
import prisma from "../src/utils/prisma.js";
import { subDays } from "date-fns";

await prisma.product.updateMany({
  where: { dateAdded: { lt: subDays(new Date(), 30) } },
  data:  { isNew: false },
});
process.exit(0);