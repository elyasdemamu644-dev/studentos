"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import type { AiConnection, AiProviderName } from "@/types/api-types";
import { Button, LoadingButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateConnection, useTestConnection, useUpdateConnection } from "./hooks";
import { DialogShell } from "@/features/tasks/task-form";
import { AI_PROVIDER_LABELS, isCredentialFreeProvider, isEndpointRequiredProvider } from "@/lib/labels";
import { cn } from "@/lib/utils";

const PROVIDERS: AiProviderName[] = ["openai", "gemini", "anthropic", "openrouter", "ollama", "custom"];

export const connectionFormSchema = z
  .object({
    provider: z.enum(["openai", "gemini", "anthropic", "openrouter", "ollama", "custom"]),
    model: z.string().trim().max(256, "Keep the model name under 256 characters").optional(),
    endpoint: z.string().trim().max(512, "Keep the endpoint under 512 characters").optional(),
    credentials: z.string().trim().max(2000, "Keep the key under 2000 characters").optional(),
  })
  .superRefine((values, ctx) => {
    // Mirrors the API contract: endpoint is mandatory for ollama/custom, and
    // credentials are mandatory for every provider that actually uses a key.
    if (isEndpointRequiredProvider(values.provider) && !values.endpoint) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endpoint"],
        message: "An endpoint is required for this provider",
      });
    }
    if (!isCredentialFreeProvider(values.provider) && !values.credentials) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["credentials"],
        message: "An API key is required for this provider",
      });
    }
  });

type ConnectionFormValues = z.infer<typeof connectionFormSchema>;

const EMPTY_VALUES: ConnectionFormValues = {
  provider: "openai",
  model: "",
  endpoint: "",
  credentials: "",
};

function toPayload(values: ConnectionFormValues) {
  return {
    provider: values.provider,
    model: values.model ? values.model : null,
    endpoint: values.endpoint ? values.endpoint : null,
    ...(values.credentials ? { credentials: values.credentials } : {}),
  };
}

export function AiConnectionFormDialog({
  open,
  onOpenChange,
  connection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection?: AiConnection;
}) {
  const createConnection = useCreateConnection();
  const updateConnection = useUpdateConnection();
  const testConnection = useTestConnection();
  const [testResult, setTestResult] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ConnectionFormValues>({
    resolver: zodResolver(connectionFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  const provider = watch("provider");
  const needsEndpoint = isEndpointRequiredProvider(provider);
  const needsCredentials = !isCredentialFreeProvider(provider);

  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    if (connection) {
      reset({
        provider: connection.provider,
        model: connection.model ?? "",
        endpoint: connection.endpoint ?? "",
        // Credentials are never returned by the API, so the field starts empty.
        // Leaving it blank on edit keeps the stored key untouched.
        credentials: "",
      });
    } else {
      reset(EMPTY_VALUES);
    }
  }, [open, connection, reset]);

  const onSubmit = async (values: ConnectionFormValues) => {
    const payload = toPayload(values);
    if (connection) {
      // Omit an empty credentials field so the saved key is preserved.
      const { credentials, ...rest } = payload;
      await updateConnection.mutateAsync({
        id: connection.id,
        input: credentials ? { ...rest, credentials } : rest,
      });
    } else {
      await createConnection.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  const onTest = async () => {
    const parsed = connectionFormSchema.safeParse(getValues());
    if (!parsed.success) {
      setTestResult("Fill in the required fields first.");
      return;
    }
    const payload = toPayload(parsed.data);
    if (connection) {
      // A saved connection already has its credentials on the server.
      const result = await testConnection.mutateAsync({ id: connection.id });
      setTestResult(result.success ? `Connected${result.model ? ` · ${result.model}` : ""}` : (result.error ?? result.message));
      return;
    }
    const result = await testConnection.mutateAsync({ input: payload });
    setTestResult(result.success ? `Connected${result.model ? ` · ${result.model}` : ""}` : (result.error ?? result.message));
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={connection ? "Edit AI connection" : "Add AI connection"}
      description="Keys are encrypted before they are stored and never sent back to the browser."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="ai-conn-provider">Provider</Label>
          <Select
            value={provider}
            onValueChange={(v) => {
              setValue("provider", v as AiProviderName, { shouldValidate: true });
              setTestResult(null);
            }}
          >
            <SelectTrigger id="ai-conn-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((p) => (
                <SelectItem key={p} value={p}>{AI_PROVIDER_LABELS[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.provider && <p className="text-sm text-danger">{errors.provider.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="ai-conn-model">Model</Label>
          <Input id="ai-conn-model" autoFocus placeholder="e.g. gpt-4o-mini" {...register("model")} />
          {errors.model && <p className="text-sm text-danger">{errors.model.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="ai-conn-endpoint">
            Endpoint{needsEndpoint ? "" : " (optional)"}
          </Label>
          <Input
            id="ai-conn-endpoint"
            type="url"
            placeholder={needsEndpoint ? "http://localhost:11434" : "https://api.example.com/v1"}
            aria-invalid={!!errors.endpoint}
            {...register("endpoint")}
          />
          {errors.endpoint && <p className="text-sm text-danger">{errors.endpoint.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="ai-conn-credentials">
            API key{needsCredentials ? "" : " (not needed)"}
          </Label>
          <Input
            id="ai-conn-credentials"
            type="password"
            autoComplete="off"
            placeholder={connection ? "Leave blank to keep the saved key" : "sk-..."}
            aria-invalid={!!errors.credentials}
            {...register("credentials")}
          />
          {errors.credentials && <p className="text-sm text-danger">{errors.credentials.message}</p>}
        </div>

        {testResult && (
          <p
            role="status"
            className={cn(
              "rounded-lg px-3 py-2 text-sm",
              testResult === "Connected" || testResult.startsWith("Connected")
                ? "bg-success/10 text-success"
                : "bg-danger/10 text-danger",
            )}
          >
            {testResult}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onTest} disabled={testConnection.isPending}>
            {testConnection.isPending ? "Testing…" : "Test connection"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <LoadingButton type="submit" loading={isSubmitting}>
            {connection ? "Save changes" : "Add connection"}
          </LoadingButton>
        </div>
      </form>
    </DialogShell>
  );
}
