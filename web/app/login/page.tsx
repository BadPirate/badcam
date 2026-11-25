import { LoginForm } from "@/components/login-form"

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-bold">badcam</h1>
      <LoginForm />
    </main>
  )
}
