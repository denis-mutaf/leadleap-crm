import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseSlaMinutes, parseWorkingHours } from "@/lib/working-hours";
import { WorkingHoursForm } from "./working-hours-form";

export default async function WorkingHoursPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("key, value").in("key", ["working_hours", "sla_first_response"]);
  const byKey = new Map((data ?? []).map((row) => [row.key as string, row.value]));

  return (
    <WorkingHoursForm
      canEdit={profile.role === "admin"}
      currentUserId={profile.id}
      initialHours={parseWorkingHours(byKey.get("working_hours"))}
      initialMinutes={parseSlaMinutes(byKey.get("sla_first_response"))}
    />
  );
}
