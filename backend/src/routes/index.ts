import { Router } from "express";

import auth from "@/routes/auth";
import academics from "@/routes/academics";
import courses from "@/routes/courses";
import dashboard from "@/routes/dashboard";
import tasks from "@/routes/tasks";
import notes from "@/routes/notes";
import resources from "@/routes/resources";
import events from "@/routes/events";
import studySessions from "@/routes/study-sessions";
import goals from "@/routes/goals";
import grades from "@/routes/grades";
import notifications from "@/routes/notifications";
import settings from "@/routes/settings";
import ai from "@/routes/ai";
import aiConnections from "@/routes/ai-connections";
import subtasks from "@/routes/subtasks";
import taskTags from "@/routes/task-tags";

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
