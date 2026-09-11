# Two explicit analyst choices, evaluated on exactly the same extracted records.
d <- read.csv("outputs/sets.csv", stringsAsFactors = FALSE)
stopifnot(nrow(d) > 0, all(d$hooks > 0), all(d$catch_n >= 0), !anyDuplicated(d$set_id))
d$year <- factor(d$year)
d$vessel <- factor(d$vessel)
models <- list(
  vessel_adjusted = glm(catch_n ~ year + vessel + offset(log(hooks / 1000)), data = d, family = poisson()),
  year_only = glm(catch_n ~ year + offset(log(hooks / 1000)), data = d, family = poisson())
)
grid <- expand.grid(year = levels(d$year), vessel = levels(d$vessel), hooks = 1000)
indices <- do.call(rbind, lapply(names(models), function(choice) {
  fit <- models[[choice]]
  stopifnot(isTRUE(fit$converged), all(is.finite(coef(fit))))
  pred <- predict(fit, newdata = grid, type = "response")
  index <- tapply(pred, grid$year, mean)
  data.frame(year = as.integer(names(index)), index = as.numeric(index / index[1]), choice = choice)
}))
write.csv(indices, "outputs/cpue.csv", row.names = FALSE)
capture.output(lapply(models, summary), file = "outputs/cpue-diagnostics.txt")
capture.output(sessionInfo(), file = "outputs/cpue-session.txt")
cat("CPUE complete: both choices converged; equal vessel weights; common first-year scaling.\n")

