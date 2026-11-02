export const runtime = "nodejs";
export {
  readControlSettings as GET,
  updateControlSettings as PATCH,
} from "@/lib/server/control-api";
