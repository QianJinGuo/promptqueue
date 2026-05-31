"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { getTask, cancelTask, getTaskEvents } from "@/lib/api-client";
import type { Task, TaskEvent } from "@promptqueue/core";
import {
  ArrowLeft,
  AlertCircle,
  Clock,
  Play,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";

const eventIcons: Record<string, React.ReactNode> = {
  created: <Clock className="h-4 w-4 text-muted-foreground" />,
  started: <Play className="h-4 w-4 text-primary" />,
  completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
  retrying: <RefreshCw className="h-4 w-4 text-yellow-500" />,
  cancelled: <XCircle className="h-4 w-4 text-muted-foreground" />,
  timed_out: <XCircle className="h-4 w-4 text-destructive" />,
};

export default function TaskDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [task, setTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [taskData, eventsData] = await Promise.all([
          getTask(id),
          getTaskEvents(id),
        ]);
        setTask(taskData);
        setEvents(eventsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load task");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const handleCancel = async () => {
    if (!task || task.status !== "pending") return;
    setCancelling(true);
    try {
      const updated = await cancelTask(id);
      setTask(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel task");
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && !task) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="mt-4" asChild>
            <Link href="/tasks">Back to Tasks</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!task) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/tasks">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Task {task.id.slice(0, 16)}...
          </h1>
          <p className="text-sm text-muted-foreground">{task.id}</p>
        </div>
        <Badge
          variant={
            task.status === "completed"
              ? "secondary"
              : task.status === "failed"
                ? "destructive"
                : "outline"
          }
        >
          {task.status}
        </Badge>
        {task.status === "pending" && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? "Cancelling..." : "Cancel Task"}
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Details */}
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Queue</span>
              <span className="font-mono text-sm">{task.queue}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Model</span>
              <span className="font-mono text-sm">{task.model}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Priority</span>
              <span className="text-sm">{task.priority}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Strategy</span>
              <span className="text-sm">{task.routingStrategy}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Max Retries</span>
              <span className="text-sm">{task.retryCount}/{task.maxRetries}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Timeout</span>
              <span className="text-sm">{task.timeout}s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Created</span>
              <span className="text-sm">
                {new Date(task.createdAt).toLocaleString()}
              </span>
            </div>
            {task.startedAt && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Started</span>
                <span className="text-sm">
                  {new Date(task.startedAt).toLocaleString()}
                </span>
              </div>
            )}
            {task.completedAt && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Completed</span>
                <span className="text-sm">
                  {new Date(task.completedAt).toLocaleString()}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Token Usage & Cost */}
        <Card>
          <CardHeader>
            <CardTitle>Usage & Cost</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {task.tokenUsage ? (
              <>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    Input Tokens
                  </span>
                  <span className="font-mono text-sm">
                    {task.tokenUsage.inputTokens.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    Output Tokens
                  </span>
                  <span className="font-mono text-sm">
                    {task.tokenUsage.outputTokens.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    Total Tokens
                  </span>
                  <span className="font-mono text-sm">
                    {(
                      task.tokenUsage.inputTokens + task.tokenUsage.outputTokens
                    ).toLocaleString()}
                  </span>
                </div>
                <div className="border-t pt-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Cost</span>
                    <span className="font-mono text-sm font-semibold">
                      ${task.costUsd?.toFixed(6) ?? "0.000000"}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not yet available
              </p>
            )}
            {task.error && (
              <div className="border-t pt-3">
                <span className="text-sm text-muted-foreground">Error</span>
                <p className="mt-1 rounded bg-destructive/10 p-2 font-mono text-xs text-destructive">
                  {task.error}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Prompt */}
      <Card>
        <CardHeader>
          <CardTitle>Prompt</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded bg-muted p-4 text-sm">
            {task.systemPrompt && (
              <>
                <span className="font-semibold text-muted-foreground">
                  System:
                </span>{" "}
                {task.systemPrompt}
                {"\n\n"}
              </>
            )}
            {task.prompt}
          </pre>
        </CardContent>
      </Card>

      {/* Result */}
      {task.result && (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded bg-muted p-4 text-sm">
              {task.result}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events recorded</p>
          ) : (
            <div className="space-y-0">
              {events.map((event, idx) => (
                <div key={event.id} className="flex gap-4 pb-4">
                  <div className="flex flex-col items-center">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                      {eventIcons[event.eventType] ?? (
                        <Clock className="h-4 w-4" />
                      )}
                    </div>
                    {idx < events.length - 1 && (
                      <div className="h-full w-px bg-border" />
                    )}
                  </div>
                  <div className="pt-1">
                    <p className="text-sm font-medium capitalize">
                      {event.eventType.replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(event.createdAt).toLocaleString()}
                    </p>
                    {event.payload && (
                      <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
