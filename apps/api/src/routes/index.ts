import { Router } from "express";

import auth from "@/modules/auth/routes";
import academics from "@/modules/academics/routes";
import courses from "@/modules/courses/routes";
import dashboard from "@/modules/dashboard/routes";
import tasks from "@/modules/tasks/routes";
import notes from "@/modules/notes/routes";
import resources from "@/modules/resources/routes";
import events from "@/modules/events/routes";
import studySessions from "@/modules/study-sessions/routes";
import goals from "@/modules/goals/routes";
import grades from "@/modules/grades/routes";
import notifications from "@/modules/notifications/routes";
import settings from "@/modules/settings/routes";
import ai from "@/modules/ai/routes";
import aiConnections from "@/modules/ai-connections/routes";
import subtasks from "@/modules/subtasks/routes";
import taskTags from "@/modules/task-tags/routes";

export const apiRouter = Router();

apiRouter.use("/auth", auth);
apiRouter.use("/academics", academics);
apiRouter.use("/courses", courses);
apiRouter.use("/dashboard", dashboard);
apiRouter.use("/tasks", tasks);

// Phase 2 modules
apiRouter.use("/notes", notes);
apiRouter.use("/resources", resources);
apiRouter.use("/events", events);
apiRouter.use("/study-sessions", studySessions);
apiRouter.use("/goals", goals);
apiRouter.use("/grades", grades);
apiRouter.use("/notifications", notifications);
apiRouter.use("/settings", settings);

// AI assistant
apiRouter.use("/ai", ai);
apiRouter.use("/ai-connections", aiConnections);

// Subtasks/tags are mounted at the root because their routers define the
// full `/tasks/:taskId/...` paths themselves.
apiRouter.use("/", subtasks);
apiRouter.use("/", taskTags);
