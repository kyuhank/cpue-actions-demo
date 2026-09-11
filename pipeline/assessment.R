# Legacy Schaefer reference; the current workflow runs assessment.py (age-structured).
# A minimal fitted biomass-dynamics model, deliberately much smaller than MFCL.
# B[t+1] = B[t] + r B[t] (1 - B[t]/K) - C[t]; I[t] = q B[t].
# r = 0.35 and initial B/K = 1 are fixed; K and q are fitted by log-index SSE.
indices <- read.csv("outputs/cpue.csv")
catch <- read.csv("outputs/catch.csv")
r <- 0.35
trajectory <- function(K, n) {
  B <- numeric(n); B[1] <- K
  if (n > 1) for (i in seq_len(n - 1)) {
    B[i+1] <- B[i] + r * B[i] * (1 - B[i] / K) - catch$catch_t[i]
    if (!is.finite(B[i+1]) || B[i+1] <= 0) return(NULL)
  }
  B
}
summaries <- list(); series <- list()
for (choice in unique(indices$choice)) {
  x <- indices[indices$choice == choice, ]; x <- x[order(x$year), ]
  stopifnot(identical(as.integer(x$year), as.integer(catch$year)), all(x$index > 0))
  objective <- function(logK) {
    B <- trajectory(exp(logK), nrow(x))
    if (is.null(B)) return(1e12)
    logq <- mean(log(x$index) - log(B))
    sum((log(x$index) - logq - log(B))^2)
  }
  fit <- optimize(objective, interval = log(c(6000, 100000)), tol = 1e-9)
  K <- exp(fit$minimum); B <- trajectory(K, nrow(x))
  stopifnot(!is.null(B), is.finite(fit$objective), fit$objective < 1e11)
  q <- exp(mean(log(x$index) - log(B)))
  summaries[[choice]] <- data.frame(choice, year = tail(x$year, 1), K, q, r,
    final_index = tail(x$index, 1), final_B_over_K = tail(B / K, 1),
    log_index_SSE = fit$objective, boundary_fit = K < 6001 || K > 99990)
  series[[choice]] <- data.frame(year = x$year, choice, biomass = B, B_over_K = B / K,
                                observed_index = x$index, fitted_index = q * B)
}
write.csv(do.call(rbind, summaries), "outputs/summary.csv", row.names = FALSE)
write.csv(do.call(rbind, series), "outputs/biomass.csv", row.names = FALSE)
capture.output(sessionInfo(), file = "outputs/assessment-session.txt")
cat("ASSESSMENT complete: two toy Schaefer fits; r and initial depletion fixed; uncertainty not estimated.\n")

