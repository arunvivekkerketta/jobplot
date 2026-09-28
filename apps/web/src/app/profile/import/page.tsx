import ImportForm from "./ImportForm";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Import JSON Resume</h1>
      <p className="text-sm text-neutral-600">
        Upload or paste a JSON Resume v1 file. It is validated with strict zod
        schemas; every highlight, keyword and entry receives a stable fact id
        used to keep your resumes truthful.
      </p>
      <ImportForm />
    </div>
  );
}
