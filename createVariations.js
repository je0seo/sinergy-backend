const createVariations = (arrays, currentIndex, currentVariation, result) => {
    if (currentIndex === arrays.length) {
        result.push([...currentVariation]);
        return;
    }
    for (let i = 0; i < arrays[currentIndex].length; i++) {
        currentVariation[currentIndex] = arrays[currentIndex][i];
        createVariations(arrays, currentIndex + 1, currentVariation, result);
    }
};

module.exports = {
    createVariations,
};