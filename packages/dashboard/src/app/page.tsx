"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
import {
  getOverviewStats,
  listTasks,
  getQueues,
  getProviders,
} from "@/lib/api-client";
import type { Task, QueueStats } from "@promptqueue/core";
import { AlertCircle, CheckCircle2, Clock, Play, XCircle } from "lucide-react";

interface ProviderInfo {
  name: string;
  models: readonly string[];
}

const statusBadgeVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "outline",
  running: "default",
  completed: "secondary",
  failed: "destructive",
  cancelled: "outline",
  timed_out: "destructive",
};

const statusIcon: Record<string, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  running: <Play className="h-4 w-4 text-primary" />,
  completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
  cancelled: <XCircle className="h-4 w-4 text-muted-foreground" />,
};

export default function OverviewPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    pending: number;
    running: number;
    failed: number;
    total: number;
  } | null>(null);
  const [recentTasks, setRecentTasks] = useState<Task[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const [statsData, tasksData, providersData] = await Promise.all([
          getOverviewStats(),
          listTasks({ limit: 5 }),
          getProviders(),
        ]);
        setStats(statsData);
        setRecentTasks(tasksData.tasks);
        setProviders(providersData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
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
    <div className="space-y-6 md:space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-sm md:text-base text-muted-foreground">
          Queue depth, recent tasks, and provider status
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{stats?.pending ?? 0}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Running</CardTitle>
            <Play className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{stats?.running ?? 0}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <XCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{stats?.failed ?? 0}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{stats?.total ?? 0}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Tasks */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Tasks</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : recentTasks.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No tasks yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Queue</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentTasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <Link
                        href={`/tasks/${task.id}`}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {task.id.slice(0, 12)}...
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant[task.status] ?? "outline"}>
                        <span className="flex items-center gap-1">
                          {statusIcon[task.status]}
                          {task.status}
                        </span>
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {task.queue}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {task.model}
                    </TableCell>
                    <TableCell>{task.priority}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(task.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Provider Status */}
      <Card>
        <CardHeader>
          <CardTitle>Providers</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No providers configured</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {providers.map((p) => (
                <Card key={p.name}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{p.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      {p.models.length} model{p.models.length !== 1 ? "s" : ""}{" "}
                      available
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
