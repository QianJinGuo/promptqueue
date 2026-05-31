"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { listTasks } from "@/lib/api-client";
import type { Task, TaskStatus } from "@promptqueue/core";
import { AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";

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

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [queueFilter, setQueueFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [queues, setQueues] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const limit = 20;

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, unknown> = { page, limit };
      if (statusFilter !== "all") params.status = statusFilter;
      if (queueFilter !== "all") params.queue = queueFilter;
      if (modelFilter !== "all") params.model = modelFilter;
      if (priorityFilter !== "all") params.priority = Number(priorityFilter);

      const result = await listTasks(params as any);
      setTasks(result.tasks);
      setTotal(result.meta.total);

      // Collect unique queues and models
      const qs = new Set<string>();
      const ms = new Set<string>();
      for (const t of result.tasks) {
        qs.add(t.queue);
        ms.add(t.model);
      }
      setQueues((prev) =>
        Array.from(new Set([...prev, ...qs]))
      );
      setModels((prev) =>
        Array.from(new Set([...prev, ...ms]))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, queueFilter, modelFilter, priorityFilter]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
        <p className="text-muted-foreground">
          View and filter all tasks
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="w-40">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="timed_out">Timed Out</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Select value={priorityFilter} onValueChange={(v) => { setPriorityFilter(v); setPage(1); }}>
            <SelectTrigger>
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="1">1 (Critical)</SelectItem>
              <SelectItem value="2">2 (High)</SelectItem>
              <SelectItem value="3">3 (Normal)</SelectItem>
              <SelectItem value="4">4 (Low)</SelectItem>
              <SelectItem value="5">5 (Best Effort)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Select value={queueFilter} onValueChange={(v) => { setQueueFilter(v); setPage(1); }}>
            <SelectTrigger>
              <SelectValue placeholder="Queue" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Queues</SelectItem>
              {queues.map((q) => (
                <SelectItem key={q} value={q}>{q}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Select value={modelFilter} onValueChange={(v) => { setModelFilter(v); setPage(1); }}>
            <SelectTrigger>
              <SelectValue placeholder="Model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Models</SelectItem>
              {models.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Tasks Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No tasks found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Queue</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Retries</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id} className="cursor-pointer">
                    <TableCell>
                      <Link
                        href={`/tasks/${task.id}`}
                        className="font-mono text-xs text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {task.id.slice(0, 12)}...
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant[task.status] ?? "outline"}>
                        {task.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{task.queue}</TableCell>
                    <TableCell className="font-mono text-xs">{task.model}</TableCell>
                    <TableCell>{task.priority}</TableCell>
                    <TableCell>{task.retryCount}/{task.maxRetries}</TableCell>
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages} ({total} total)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
