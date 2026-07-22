import { createClient } from "@supabase/supabase-js";

const requiredVariables = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "E2E_ADMIN_EMAIL",
  "E2E_ADMIN_PASSWORD",
  "E2E_USER_EMAIL",
  "E2E_USER_PASSWORD",
];

const missingVariables = requiredVariables.filter((name) => !process.env[name]);
if (missingVariables.length > 0) {
  throw new Error(
    `Missing local E2E variables: ${missingVariables.join(", ")}`,
  );
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function findUserByEmail(email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) throw error;

    const user = data.users.find((candidate) => candidate.email === email);
    if (user) return user;
    if (data.users.length < 100) return undefined;
  }
}

async function seedUser(email, password) {
  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    const { error } = await supabase.auth.admin.updateUserById(
      existingUser.id,
      {
        password,
        email_confirm: true,
      },
    );
    if (error) throw error;
    return;
  }

  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
}

await seedUser(process.env.E2E_ADMIN_EMAIL, process.env.E2E_ADMIN_PASSWORD);
await seedUser(process.env.E2E_USER_EMAIL, process.env.E2E_USER_PASSWORD);

console.log("Seeded disposable local E2E accounts");
