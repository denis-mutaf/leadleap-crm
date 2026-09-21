import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

// Профиль спрашивают и раскладка, и сама страница, и половина вложенных
// экранов — 22 файла. Каждый вызов стоил двух походов в Supabase (кто я,
// потом строка профиля), то есть 300–400 мс на переход, всегда за одним и
// тем же ответом. cache() держит ответ в пределах одного запроса.
export const getCurrentProfile = cache(
  async function getCurrentProfile(): Promise<Profile | null> {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return null;
    }

    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!data) {
      return null;
    }

    if (!(data as Profile).is_active) {
      return null;
    }

    return data as Profile;
  },
);
