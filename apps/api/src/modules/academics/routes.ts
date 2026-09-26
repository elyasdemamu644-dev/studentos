import { Router } from "express";
import academicYearsRouter from "./academic-years/routes";
import semestersRouter from "./semesters/routes";

const router = Router();

// Mount sub-routers
router.use("/academic-years", academicYearsRouter);
router.use("/years", academicYearsRouter);
router.use("/semesters", semestersRouter);

export default router;