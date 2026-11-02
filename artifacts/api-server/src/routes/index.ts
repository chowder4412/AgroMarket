import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountRouter from "./account";
import productsRouter from "./products";
import commerceRouter from "./commerce";
import sellerRouter from "./seller";
import adminRouter from "./admin";
import quotationsRouter from "./quotations";
import paymentsRouter from "./payments";
import disputesRouter from "./disputes";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accountRouter);
router.use(productsRouter);
router.use(commerceRouter);
router.use(sellerRouter);
router.use(adminRouter);
router.use(quotationsRouter);
router.use(paymentsRouter);
router.use(disputesRouter);

export default router;
