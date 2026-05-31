"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { getProviders, getProviderHealth } from "@/lib/api-client";
import { AlertCircle, Cpu, Activity } from "lucide-react";

interface ProviderInfo {
  name: string;
  models: readonly string[];
}

interface ProviderHealthResult {
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  details?: string;
}

const healthBadgeVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  healthy: "secondary",
  degraded: "outline",
  down: "destructive",
};

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [healthMap, setHealthMap] = useState<
    Record<string, ProviderHealthResult>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await getProviders();
        setProviders(data);

        const healthResults: Record<string, ProviderHealthResult> = {};
        await Promise.allSettled(
          data.map(async (p) => {
            try {
              const health = await getProviderHealth(p.name);
              healthResults[p.name] = health;
            } catch {
              healthResults[p.name] = {
                status: "down",
                latencyMs: 0,
                details: "Unreachable",
              };
            }
          })
        );
        setHealthMap(healthResults);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load providers"
        );
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Providers</h1>
        <p className="text-muted-foreground">
          Provider health status, latency, and model list
        </p>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : providers.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No providers configured
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {providers.map((p) => {
            const health = healthMap[p.name];
            return (
              <Card key={p.name}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Cpu className="h-5 w-5 text-muted-foreground" />
                      <CardTitle className="text-lg">{p.name}</CardTitle>
                    </div>
                    {health && (
                      <Badge variant={healthBadgeVariant[health.status] ?? "outline"}>
                        <span className="flex items-center gap-1">
                          <Activity className="h-3 w-3" />
                          {health.status}
                        </span>
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {health && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Latency</span>
                      <span className="font-mono">{health.latencyMs}ms</span>
                    </div>
                  )}
                  {health?.details && (
                    <p className="text-xs text-muted-foreground">
                      {health.details}
                    </p>
                  )}
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Models ({p.models.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {p.models.map((m) => (
                        <Badge key={m} variant="outline" className="font-mono text-xs">
                          {m}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All Providers</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : providers.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No providers configured
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>Models</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.map((p) => {
                  const health = healthMap[p.name];
                  return (
                    <TableRow key={p.name}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>
                        {health ? (
                          <Badge variant={healthBadgeVariant[health.status] ?? "outline"}>
                            {health.status}
                          </Badge>
                        ) : (
                          <Badge variant="outline">checking...</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {health ? `${health.latencyMs}ms` : "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.models.length}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
