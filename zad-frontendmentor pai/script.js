let button = document.querySelectorAll(".rating-btn");
let submitBtn = document.querySelector("#submit-btn");
let thankYouContainer = document.querySelector(".thank-you-section");
let ratingContainer = document.querySelector(".rating-section");
let rateSelectedContainer = document.querySelector(".rate-selected");
let ratingSelected;

// button.forEach((btn) => {
//   btn.addEventListener("click", () => {
//     // remove active from all rate buttons
//     button.forEach((btn) => {
//       btn.classList.remove("active");
//     });

//     // add active style to selected rate
//     btn.classList.add("active");
//     ratingSelected = btn.textContent;
//     console.log(ratingSelected);
//   });
// });

button.forEach((btn) => {

  btn.addEventListener("click", () => {
    ratingSelected = btn.textContent;
    console.log(ratingSelected);

    // remove active from every rate button
    button.forEach((btn) => {
      btn.classList.remove("active");
    });

    // add active to all rating button up to the point selected
    for (let i = 0; i < ratingSelected; i++) {
      button[i].classList.add("active");
    }
  });

});

submitBtn.addEventListener("click", () => {
  thankYouContainer.style.display = "flex";
  ratingContainer.style.display = "none";
  rateSelectedContainer.textContent = ratingSelected;
});
